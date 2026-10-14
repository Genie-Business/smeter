// Admin dashboard API for the smeter team: content editing, property owners,
// meters, purchases, onboarding leads. Read-mostly over operational data.
import { randomBytes } from 'node:crypto';
import express, { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { db, now } from '../db.js';
import { requireStaff } from '../auth/middleware.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { signAccessToken } from '../auth/tokens.js';
import { contentHistory, getContent, resetContent, restoreContent, saveContent } from '../services/content.js';
import {
  PAYMENT_CHANNELS, getPaymentSettings, getTariffSettings, paymentSettingsDefaults, resetPaymentSettings,
  resetTariffSettings, savePaymentSettings, saveTariffSettings, tariffImpact, tariffSettingsDefaults, tariffSettingsSchema,
} from '../services/settings.js';
import { liveReading } from '../services/usage.js';
import { landlordPurchaseDto } from '../services/vending.js';
import { badRequest, conflict, notFound, unauthorized } from '../util/errors.js';
import { koboToNaira, pageParams, parse } from '../util/http.js';
import { rateLimit } from '../util/rateLimit.js';
import { landlordDto, meterDto } from './dto.js';

export const staffRoutes = Router();

const staffDto = (s) => ({ id: s.id, email: s.email, name: s.name, role: s.role, lastLoginAt: s.last_login_at ?? null });

// ---- Auth --------------------------------------------------------------------

staffRoutes.post('/login', rateLimit({ key: 'staff-login', limit: 10, windowMs: 15 * 60 * 1000 }), async (req, res) => {
  const body = parse(z.object({ email: z.string().trim().toLowerCase(), password: z.string().min(1).max(200) }), req.body);
  const staff = await db().get('SELECT * FROM staff WHERE email = ?', body.email);
  if (!staff || !(await verifyPassword(body.password, staff.password_hash))) {
    throw unauthorized('Incorrect email or password');
  }
  await db().run('UPDATE staff SET last_login_at = ? WHERE id = ?', now(), staff.id);
  res.json({ token: await signAccessToken({ role: 'staff', sub: staff.id }), staff: staffDto(staff) });
});

staffRoutes.use(requireStaff());

staffRoutes.get('/me', (req, res) => res.json({ staff: staffDto(req.staff) }));

staffRoutes.get('/users', async (req, res) => {
  res.json({ data: (await db().all('SELECT * FROM staff ORDER BY id')).map(staffDto) });
});

staffRoutes.post('/users', requireStaff({ role: 'owner' }), async (req, res) => {
  const body = parse(
    z.object({
      email: z.string().trim().toLowerCase().email(),
      name: z.string().trim().min(2).max(80),
      password: z.string().min(10, 'Use at least 10 characters').max(200),
      role: z.enum(['owner', 'editor']).default('editor'),
    }),
    req.body,
  );
  const created = await db().get(
    `INSERT INTO staff (email, name, password_hash, role) VALUES (?, ?, ?, ?)
     ON CONFLICT (email) DO NOTHING RETURNING *`,
    body.email, body.name, await hashPassword(body.password), body.role,
  );
  if (!created) throw conflict('That email already has an account');
  res.status(201).json({ staff: staffDto(created) });
});

// ---- Overview ----------------------------------------------------------------

staffRoutes.get('/overview', async (_req, res) => {
  const one = (sql, ...a) => db().get(sql, ...a);
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const today = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const [vended, seriesRows, todayRow, landlords, meters, awaiting, tickets, leads, signups, recent] = await Promise.all([
    one(
      `SELECT COUNT(*) n, COALESCE(SUM(total_kobo),0) gross, COALESCE(SUM(units),0) units,
         COALESCE(SUM(landlord_net_kobo),0) owners, COALESCE(SUM(fee_kobo),0) fees
       FROM purchases WHERE status = 'vended' AND vended_at >= ?`,
      since30,
    ),
    db().all(
      `SELECT substr(vended_at, 1, 10) AS day, COUNT(*) n, SUM(total_kobo) gross FROM purchases
       WHERE status = 'vended' AND vended_at >= ? GROUP BY 1 ORDER BY 1`,
      since30,
    ),
    one(`SELECT COUNT(*) n, COALESCE(SUM(total_kobo),0) gross FROM purchases WHERE status='vended' AND vended_at >= ?`, today),
    one('SELECT COUNT(*) n FROM landlords'),
    one(
      `SELECT COUNT(*) total,
         COUNT(*) FILTER (WHERE status = 'active') active,
         COUNT(*) FILTER (WHERE status = 'invited') invited,
         COUNT(*) FILTER (WHERE delivery_mode = 'manual') manual,
         COUNT(*) FILTER (WHERE relay_state LIKE 'disconnect%') off
       FROM meters WHERE status != 'removed'`,
    ),
    one(`SELECT COUNT(*) n FROM purchases WHERE status IN ('paid','vending')`),
    one(`SELECT COUNT(*) n FROM support_tickets WHERE status != 'resolved'`),
    one(`SELECT COUNT(*) n FROM owner_leads WHERE status = 'new'`),
    one('SELECT COUNT(*) n FROM notify_requests'),
    db().all(`SELECT * FROM purchases ORDER BY id DESC LIMIT 8`),
  ]);
  res.json({
    landlords: landlords.n,
    meters,
    last30: {
      purchases: vended.n,
      gross: koboToNaira(vended.gross),
      units: Math.round(vended.units * 100) / 100,
      toOwners: koboToNaira(vended.owners),
      fees: koboToNaira(vended.fees),
    },
    today: { purchases: todayRow.n, gross: koboToNaira(todayRow.gross) },
    attention: {
      awaitingToken: awaiting.n,
      openTickets: tickets.n,
      newLeads: leads.n,
      notifySignups: signups.n,
    },
    series: seriesRows.map((r) => ({ day: r.day, purchases: r.n, gross: koboToNaira(r.gross) })),
    recent: recent.map(landlordPurchaseDto),
  });
});

// ---- Property owners ----------------------------------------------------------

/** `%term%` for ILIKE, with LIKE wildcards in the term escaped. */
const searchTerm = (v) => `%${String(v ?? '').trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

staffRoutes.get('/landlords', async (req, res) => {
  const { pageSize, offset, page } = pageParams(req.query);
  const q = searchTerm(req.query.search);
  const where = `(l.full_name ILIKE ? OR l.email ILIKE ? OR l.phone ILIKE ?)`;
  const rows = await db().all(
    `SELECT l.*,
       (SELECT COUNT(*) FROM meters m WHERE m.landlord_id = l.id AND m.status != 'removed') meter_count,
       (SELECT COALESCE(SUM(total_kobo),0) FROM purchases p WHERE p.landlord_id = l.id AND p.status = 'vended') collected,
       (SELECT COALESCE(SUM(landlord_net_kobo),0) FROM purchases p WHERE p.landlord_id = l.id AND p.status = 'vended') earned,
       (SELECT MAX(vended_at) FROM purchases p WHERE p.landlord_id = l.id AND p.status = 'vended') last_sale
     FROM landlords l WHERE ${where} ORDER BY l.id DESC LIMIT ? OFFSET ?`,
    q, q, q, pageSize, offset,
  );
  const { n } = await db().get(`SELECT COUNT(*) n FROM landlords l WHERE ${where}`, q, q, q);
  res.json({
    data: rows.map((l) => ({
      ...landlordDto(l),
      createdAt: l.created_at,
      meterCount: l.meter_count,
      collected: koboToNaira(l.collected),
      earned: koboToNaira(l.earned),
      lastSale: l.last_sale,
    })),
    page,
    pageSize,
    total: n,
  });
});

staffRoutes.get('/landlords/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw notFound('Property owner not found');
  const l = await db().get('SELECT * FROM landlords WHERE id = ?', id);
  if (!l) throw notFound('Property owner not found');
  const [meters, purchases, totals] = await Promise.all([
    db().all("SELECT * FROM meters WHERE landlord_id = ? AND status != 'removed' ORDER BY id DESC", l.id),
    db().all('SELECT * FROM purchases WHERE landlord_id = ? ORDER BY id DESC LIMIT 30', l.id),
    db().get(
      `SELECT COUNT(*) n, COALESCE(SUM(total_kobo),0) collected, COALESCE(SUM(landlord_net_kobo),0) earned,
         COALESCE(SUM(units),0) units FROM purchases WHERE landlord_id = ? AND status = 'vended'`,
      l.id,
    ),
  ]);
  res.json({
    landlord: { ...landlordDto(l), createdAt: l.created_at },
    totals: {
      purchases: totals.n,
      collected: koboToNaira(totals.collected),
      earned: koboToNaira(totals.earned),
      units: Math.round(totals.units * 100) / 100,
    },
    meters: meters.map(meterDto),
    purchases: purchases.map(landlordPurchaseDto),
  });
});

// ---- Meters -----------------------------------------------------------------------

staffRoutes.get('/meters', async (req, res) => {
  const { pageSize, offset, page } = pageParams(req.query);
  const q = searchTerm(req.query.search);
  const filters = ["m.status != 'removed'", '(m.meter_id ILIKE ? OR m.address ILIKE ? OR m.tenant_phone ILIKE ? OR m.tenant_first_name ILIKE ? OR l.full_name ILIKE ?)'];
  const args = [q, q, q, q, q];
  if (['ota', 'manual'].includes(req.query.mode)) {
    filters.push('m.delivery_mode = ?');
    args.push(req.query.mode);
  }
  if (['active', 'invited'].includes(req.query.status)) {
    filters.push('m.status = ?');
    args.push(req.query.status);
  }
  const where = filters.join(' AND ');
  const rows = await db().all(
    `SELECT m.*, l.full_name landlord_name,
       (SELECT COALESCE(SUM(total_kobo),0) FROM purchases p WHERE p.meter_id = m.meter_id AND p.status = 'vended') spent,
       (SELECT MAX(vended_at) FROM purchases p WHERE p.meter_id = m.meter_id AND p.status = 'vended') last_purchase
     FROM meters m JOIN landlords l ON l.id = m.landlord_id WHERE ${where} ORDER BY m.id DESC LIMIT ? OFFSET ?`,
    ...args, pageSize, offset,
  );
  const { n } = await db().get(`SELECT COUNT(*) n FROM meters m JOIN landlords l ON l.id = m.landlord_id WHERE ${where}`, ...args);
  res.json({
    data: rows.map((m) => ({
      ...meterDto(m),
      landlordId: m.landlord_id,
      landlordName: m.landlord_name,
      spent: koboToNaira(m.spent),
      lastPurchase: m.last_purchase,
    })),
    page,
    pageSize,
    total: n,
  });
});

staffRoutes.get('/meters/:meterId', async (req, res) => {
  const m = await db().get('SELECT * FROM meters WHERE meter_id = ?', req.params.meterId);
  if (!m) throw notFound('Meter not found');
  const [l, purchases] = await Promise.all([
    db().get('SELECT * FROM landlords WHERE id = ?', m.landlord_id),
    db().all('SELECT * FROM purchases WHERE meter_id = ? ORDER BY id DESC LIMIT 50', m.meter_id),
  ]);
  let live = null;
  try {
    live = m.status === 'removed' ? null : await liveReading(m);
  } catch {
    /* head-end unreachable */
  }
  res.json({
    meter: meterDto(m),
    landlord: l ? { id: l.id, fullName: l.full_name, phone: l.phone, email: l.email } : null,
    live,
    purchases: purchases.map(landlordPurchaseDto),
  });
});

staffRoutes.get('/purchases', async (req, res) => {
  const { pageSize, offset, page } = pageParams(req.query);
  const statuses = ['pending', 'paid', 'vending', 'vended', 'failed', 'abandoned'];
  const status = statuses.includes(req.query.status) ? req.query.status : null;
  const where = status ? 'status = ?' : '1=1';
  const args = status ? [status] : [];
  const rows = await db().all(`SELECT * FROM purchases WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`, ...args, pageSize, offset);
  const { n } = await db().get(`SELECT COUNT(*) n FROM purchases WHERE ${where}`, ...args);
  res.json({ data: rows.map(landlordPurchaseDto), page, pageSize, total: n });
});

// ---- Leads & sign-ups ---------------------------------------------------------------

staffRoutes.get('/leads', async (req, res) => {
  const { pageSize, offset, page } = pageParams(req.query);
  const rows = await db().all('SELECT * FROM owner_leads ORDER BY id DESC LIMIT ? OFFSET ?', pageSize, offset);
  const { n } = await db().get('SELECT COUNT(*) n FROM owner_leads');
  res.json({
    data: rows.map((r) => ({
      id: r.id,
      fullName: r.full_name,
      phone: r.phone,
      email: r.email,
      city: r.city,
      propertyType: r.property_type,
      units: r.units,
      message: r.message,
      status: r.status,
      note: r.note,
      createdAt: r.created_at,
    })),
    page,
    pageSize,
    total: n,
  });
});

staffRoutes.patch('/leads/:id', async (req, res) => {
  const body = parse(
    z.object({
      status: z.enum(['new', 'contacted', 'surveyed', 'onboarded', 'closed']).optional(),
      note: z.string().trim().max(2000).optional(),
    }),
    req.body,
  );
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw notFound('Lead not found');
  const r = await db().run(
    'UPDATE owner_leads SET status = COALESCE(?, status), note = COALESCE(?, note) WHERE id = ?',
    body.status ?? null, body.note ?? null, id,
  );
  if (r.changes !== 1) throw notFound('Lead not found');
  res.json({ ok: true });
});

staffRoutes.get('/notify-requests', async (_req, res) => {
  const rows = await db().all('SELECT * FROM notify_requests ORDER BY id DESC LIMIT 500');
  res.json({ data: rows.map((r) => ({ id: r.id, contact: r.contact, platform: r.platform, createdAt: r.created_at })) });
});

// ---- Content ------------------------------------------------------------------------

staffRoutes.get('/content/:key', async (req, res) => {
  res.json({ ...(await getContent(req.params.key)), history: await contentHistory(req.params.key) });
});

staffRoutes.put('/content/:key', async (req, res) => {
  const body = parse(z.object({ data: z.record(z.string(), z.any()), version: z.number().int().min(0).optional() }), req.body);
  const saved = await saveContent(req.params.key, body.data, req.staff.id, body.version);
  res.json({ ...saved, history: await contentHistory(req.params.key) });
});

staffRoutes.post('/content/:key/restore', async (req, res) => {
  const { version } = parse(z.object({ version: z.number().int().min(1) }), req.body);
  const saved = await restoreContent(req.params.key, version, req.staff.id);
  res.json({ ...saved, history: await contentHistory(req.params.key) });
});

staffRoutes.post('/content/:key/reset', async (req, res) => {
  const saved = await resetContent(req.params.key, req.staff.id);
  res.json({ ...saved, history: await contentHistory(req.params.key) });
});

// ---- Payment settings -----------------------------------------------------------------
// Everyone on the team can view; only account owners can change them.

const paymentSettingsResponse = (settings) => ({
  settings,
  defaults: paymentSettingsDefaults(),
  channelOptions: PAYMENT_CHANNELS,
});

staffRoutes.get('/settings/payments', async (_req, res) => {
  res.json(paymentSettingsResponse(await getPaymentSettings({ fresh: true })));
});

staffRoutes.put('/settings/payments', requireStaff({ role: 'owner' }), async (req, res) => {
  res.json(paymentSettingsResponse(await savePaymentSettings(req.body ?? {}, req.staff.id)));
});

staffRoutes.post('/settings/payments/reset', requireStaff({ role: 'owner' }), async (_req, res) => {
  res.json(paymentSettingsResponse(await resetPaymentSettings()));
});

// Unit price limits (owners set their own price between these).
const tariffSettingsResponse = async (settings) => ({
  settings,
  defaults: tariffSettingsDefaults(),
  impact: await tariffImpact(settings),
});

staffRoutes.get('/settings/tariff', async (_req, res) => {
  res.json(await tariffSettingsResponse(await getTariffSettings({ fresh: true })));
});

// ?preview: report the impact of unsaved values without saving.
staffRoutes.post('/settings/tariff/preview', async (req, res) => {
  const parsed = tariffSettingsSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw badRequest(parsed.error.issues[0].message);
  res.json({ impact: await tariffImpact(parsed.data) });
});

staffRoutes.put('/settings/tariff', requireStaff({ role: 'owner' }), async (req, res) => {
  res.json(await tariffSettingsResponse(await saveTariffSettings(req.body ?? {}, req.staff.id)));
});

staffRoutes.post('/settings/tariff/reset', requireStaff({ role: 'owner' }), async (_req, res) => {
  res.json(await tariffSettingsResponse(await resetTariffSettings()));
});

// Image upload for content fields. Raw body; type sniffed from magic bytes.
// Stored in the database (serverless hosts have no persistent disk) and served
// from /uploads/:name. Vercel caps request bodies at 4.5 MB.
const SIGNATURES = [
  { ext: 'png', mime: 'image/png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: 'jpg', mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'webp', mime: 'image/webp', test: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
];

staffRoutes.post('/uploads', express.raw({ type: ['image/*', 'application/octet-stream'], limit: '4mb' }), async (req, res) => {
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length < 16) throw badRequest('Choose an image to upload');
  const kind = SIGNATURES.find((s) => s.test(buf));
  if (!kind) throw badRequest('Only PNG, JPEG or WebP images are supported');
  const name = `${Date.now().toString(36)}-${randomBytes(6).toString('hex')}.${kind.ext}`;
  await db().run('INSERT INTO uploads (name, mime, data) VALUES (?, ?, ?)', name, kind.mime, buf);
  res.status(201).json({ url: `/uploads/${name}`, absoluteUrl: `${config.publicUrl}/uploads/${name}` });
});

/** Serves uploaded images (public; names are random and immutable). */
export async function serveUpload(req, res) {
  const name = String(req.params.name ?? '');
  if (!/^[a-z0-9-]+\.(png|jpg|webp)$/.test(name)) throw notFound();
  const row = await db().get('SELECT mime, data FROM uploads WHERE name = ?', name);
  if (!row) throw notFound();
  res.set({ 'Content-Type': row.mime, 'Cache-Control': 'public, max-age=31536000, immutable' });
  res.send(Buffer.from(row.data));
}

/** Create the first owner account from env on boot if there are no staff yet. */
export async function bootstrapStaff() {
  const { email, password, name } = config.bootstrapStaff;
  if (!email || !password) return;
  const { n } = await db().get('SELECT COUNT(*) n FROM staff');
  if (n > 0) return;
  const created = await db().run(
    "INSERT INTO staff (email, name, password_hash, role) VALUES (?, ?, ?, 'owner') ON CONFLICT (email) DO NOTHING",
    email.toLowerCase(), name, await hashPassword(password),
  );
  if (created.changes) console.log(`[staff] created admin dashboard owner account for ${email}`);
}
