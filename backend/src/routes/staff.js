// Admin dashboard API for the smeter team: content editing, property owners,
// meters, purchases, onboarding leads. Read-mostly over operational data.
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import express, { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { db, now } from '../db.js';
import { requireStaff } from '../auth/middleware.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { signAccessToken } from '../auth/tokens.js';
import { contentHistory, getContent, resetContent, restoreContent, saveContent } from '../services/content.js';
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
  const staff = db().prepare('SELECT * FROM staff WHERE email = ?').get(body.email);
  if (!staff || !(await verifyPassword(body.password, staff.password_hash))) {
    throw unauthorized('Incorrect email or password');
  }
  db().prepare('UPDATE staff SET last_login_at = ? WHERE id = ?').run(now(), staff.id);
  res.json({ token: await signAccessToken({ role: 'staff', sub: staff.id }), staff: staffDto(staff) });
});

staffRoutes.use(requireStaff());

staffRoutes.get('/me', (req, res) => res.json({ staff: staffDto(req.staff) }));

staffRoutes.get('/users', (req, res) => {
  res.json({ data: db().prepare('SELECT * FROM staff ORDER BY id').all().map(staffDto) });
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
  if (db().prepare('SELECT 1 FROM staff WHERE email = ?').get(body.email)) throw conflict('That email already has an account');
  const info = db()
    .prepare('INSERT INTO staff (email, name, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(body.email, body.name, await hashPassword(body.password), body.role);
  res.status(201).json({ staff: staffDto(db().prepare('SELECT * FROM staff WHERE id = ?').get(info.lastInsertRowid)) });
});

// ---- Overview ----------------------------------------------------------------

staffRoutes.get('/overview', (_req, res) => {
  const one = (sql, ...a) => db().prepare(sql).get(...a);
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const today = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const vended = one(
    `SELECT COUNT(*) n, COALESCE(SUM(total_kobo),0) gross, COALESCE(SUM(units),0) units,
       COALESCE(SUM(landlord_net_kobo),0) owners, COALESCE(SUM(fee_kobo),0) fees
     FROM purchases WHERE status = 'vended' AND vended_at >= ?`,
    since30,
  );
  const series = db()
    .prepare(
      `SELECT substr(vended_at, 1, 10) day, COUNT(*) n, SUM(total_kobo) gross FROM purchases
       WHERE status = 'vended' AND vended_at >= ? GROUP BY day ORDER BY day`,
    )
    .all(since30)
    .map((r) => ({ day: r.day, purchases: r.n, gross: koboToNaira(r.gross) }));
  const todayRow = one(
    `SELECT COUNT(*) n, COALESCE(SUM(total_kobo),0) gross FROM purchases WHERE status='vended' AND vended_at >= ?`,
    today,
  );
  res.json({
    landlords: one('SELECT COUNT(*) n FROM landlords').n,
    meters: one(
      `SELECT COUNT(*) total, SUM(status='active') active, SUM(status='invited') invited,
         SUM(delivery_mode='manual') manual, SUM(relay_state LIKE 'disconnect%') off
       FROM meters WHERE status != 'removed'`,
    ),
    last30: {
      purchases: vended.n,
      gross: koboToNaira(vended.gross),
      units: Math.round(vended.units * 100) / 100,
      toOwners: koboToNaira(vended.owners),
      fees: koboToNaira(vended.fees),
    },
    today: { purchases: todayRow.n, gross: koboToNaira(todayRow.gross) },
    attention: {
      awaitingToken: one(`SELECT COUNT(*) n FROM purchases WHERE status IN ('paid','vending')`).n,
      openTickets: one(`SELECT COUNT(*) n FROM support_tickets WHERE status != 'resolved'`).n,
      newLeads: one(`SELECT COUNT(*) n FROM owner_leads WHERE status = 'new'`).n,
      notifySignups: one('SELECT COUNT(*) n FROM notify_requests').n,
    },
    series,
    recent: db().prepare(`SELECT * FROM purchases ORDER BY id DESC LIMIT 8`).all().map(landlordPurchaseDto),
  });
});

// ---- Property owners ----------------------------------------------------------

staffRoutes.get('/landlords', (req, res) => {
  const { pageSize, offset, page } = pageParams(req.query);
  const q = `%${String(req.query.search ?? '').trim()}%`;
  const where = `(l.full_name LIKE ? OR l.email LIKE ? OR l.phone LIKE ?)`;
  const rows = db()
    .prepare(
      `SELECT l.*,
         (SELECT COUNT(*) FROM meters m WHERE m.landlord_id = l.id AND m.status != 'removed') meter_count,
         (SELECT COALESCE(SUM(total_kobo),0) FROM purchases p WHERE p.landlord_id = l.id AND p.status = 'vended') collected,
         (SELECT COALESCE(SUM(landlord_net_kobo),0) FROM purchases p WHERE p.landlord_id = l.id AND p.status = 'vended') earned,
         (SELECT MAX(vended_at) FROM purchases p WHERE p.landlord_id = l.id AND p.status = 'vended') last_sale
       FROM landlords l WHERE ${where} ORDER BY l.id DESC LIMIT ? OFFSET ?`,
    )
    .all(q, q, q, pageSize, offset);
  const { n } = db().prepare(`SELECT COUNT(*) n FROM landlords l WHERE ${where}`).get(q, q, q);
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

staffRoutes.get('/landlords/:id', (req, res) => {
  const l = db().prepare('SELECT * FROM landlords WHERE id = ?').get(Number(req.params.id));
  if (!l) throw notFound('Property owner not found');
  const meters = db().prepare("SELECT * FROM meters WHERE landlord_id = ? AND status != 'removed' ORDER BY id DESC").all(l.id);
  const purchases = db().prepare('SELECT * FROM purchases WHERE landlord_id = ? ORDER BY id DESC LIMIT 30').all(l.id);
  const totals = db()
    .prepare(
      `SELECT COUNT(*) n, COALESCE(SUM(total_kobo),0) collected, COALESCE(SUM(landlord_net_kobo),0) earned,
         COALESCE(SUM(units),0) units FROM purchases WHERE landlord_id = ? AND status = 'vended'`,
    )
    .get(l.id);
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

staffRoutes.get('/meters', (req, res) => {
  const { pageSize, offset, page } = pageParams(req.query);
  const q = `%${String(req.query.search ?? '').trim()}%`;
  const filters = ["m.status != 'removed'", '(m.meter_id LIKE ? OR m.address LIKE ? OR m.tenant_phone LIKE ? OR m.tenant_first_name LIKE ? OR l.full_name LIKE ?)'];
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
  const rows = db()
    .prepare(
      `SELECT m.*, l.full_name landlord_name,
         (SELECT COALESCE(SUM(total_kobo),0) FROM purchases p WHERE p.meter_id = m.meter_id AND p.status = 'vended') spent,
         (SELECT MAX(vended_at) FROM purchases p WHERE p.meter_id = m.meter_id AND p.status = 'vended') last_purchase
       FROM meters m JOIN landlords l ON l.id = m.landlord_id WHERE ${where} ORDER BY m.id DESC LIMIT ? OFFSET ?`,
    )
    .all(...args, pageSize, offset);
  const { n } = db().prepare(`SELECT COUNT(*) n FROM meters m JOIN landlords l ON l.id = m.landlord_id WHERE ${where}`).get(...args);
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
  const m = db().prepare('SELECT * FROM meters WHERE meter_id = ?').get(req.params.meterId);
  if (!m) throw notFound('Meter not found');
  const l = db().prepare('SELECT * FROM landlords WHERE id = ?').get(m.landlord_id);
  const purchases = db().prepare('SELECT * FROM purchases WHERE meter_id = ? ORDER BY id DESC LIMIT 50').all(m.meter_id);
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

staffRoutes.get('/purchases', (req, res) => {
  const { pageSize, offset, page } = pageParams(req.query);
  const statuses = ['pending', 'paid', 'vending', 'vended', 'failed', 'abandoned'];
  const status = statuses.includes(req.query.status) ? req.query.status : null;
  const where = status ? 'status = ?' : '1=1';
  const args = status ? [status] : [];
  const rows = db().prepare(`SELECT * FROM purchases WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, pageSize, offset);
  const { n } = db().prepare(`SELECT COUNT(*) n FROM purchases WHERE ${where}`).get(...args);
  res.json({ data: rows.map(landlordPurchaseDto), page, pageSize, total: n });
});

// ---- Leads & sign-ups ---------------------------------------------------------------

staffRoutes.get('/leads', (req, res) => {
  const { pageSize, offset, page } = pageParams(req.query);
  const rows = db().prepare('SELECT * FROM owner_leads ORDER BY id DESC LIMIT ? OFFSET ?').all(pageSize, offset);
  const { n } = db().prepare('SELECT COUNT(*) n FROM owner_leads').get();
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

staffRoutes.patch('/leads/:id', (req, res) => {
  const body = parse(
    z.object({
      status: z.enum(['new', 'contacted', 'surveyed', 'onboarded', 'closed']).optional(),
      note: z.string().trim().max(2000).optional(),
    }),
    req.body,
  );
  const r = db()
    .prepare('UPDATE owner_leads SET status = COALESCE(?, status), note = COALESCE(?, note) WHERE id = ?')
    .run(body.status ?? null, body.note ?? null, Number(req.params.id));
  if (r.changes !== 1) throw notFound('Lead not found');
  res.json({ ok: true });
});

staffRoutes.get('/notify-requests', (_req, res) => {
  res.json({
    data: db()
      .prepare('SELECT * FROM notify_requests ORDER BY id DESC LIMIT 500')
      .all()
      .map((r) => ({ id: r.id, contact: r.contact, platform: r.platform, createdAt: r.created_at })),
  });
});

// ---- Content ------------------------------------------------------------------------

staffRoutes.get('/content/:key', (req, res) => {
  res.json({ ...getContent(req.params.key), history: contentHistory(req.params.key) });
});

staffRoutes.put('/content/:key', (req, res) => {
  const body = parse(z.object({ data: z.record(z.string(), z.any()), version: z.number().int().min(0).optional() }), req.body);
  const saved = saveContent(req.params.key, body.data, req.staff.id, body.version);
  res.json({ ...saved, history: contentHistory(req.params.key) });
});

staffRoutes.post('/content/:key/restore', (req, res) => {
  const { version } = parse(z.object({ version: z.number().int().min(1) }), req.body);
  const saved = restoreContent(req.params.key, version, req.staff.id);
  res.json({ ...saved, history: contentHistory(req.params.key) });
});

staffRoutes.post('/content/:key/reset', (req, res) => {
  const saved = resetContent(req.params.key, req.staff.id);
  res.json({ ...saved, history: contentHistory(req.params.key) });
});

// Image upload for content fields. Raw body; type sniffed from magic bytes.
const SIGNATURES = [
  { ext: 'png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'webp', test: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
];

staffRoutes.post('/uploads', express.raw({ type: ['image/*', 'application/octet-stream'], limit: '6mb' }), (req, res) => {
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length < 16) throw badRequest('Choose an image to upload');
  const kind = SIGNATURES.find((s) => s.test(buf));
  if (!kind) throw badRequest('Only PNG, JPEG or WebP images are supported');
  mkdirSync(config.uploadDir, { recursive: true });
  const name = `${Date.now().toString(36)}-${randomBytes(6).toString('hex')}.${kind.ext}`;
  writeFileSync(join(config.uploadDir, name), buf);
  res.status(201).json({ url: `/uploads/${name}`, absoluteUrl: `${config.publicUrl}/uploads/${name}` });
});

/** Create the first owner account from env on boot if there are no staff yet. */
export async function bootstrapStaff() {
  const { email, password, name } = config.bootstrapStaff;
  if (!email || !password) return;
  const { n } = db().prepare('SELECT COUNT(*) n FROM staff').get();
  if (n > 0) return;
  db()
    .prepare("INSERT INTO staff (email, name, password_hash, role) VALUES (?, ?, ?, 'owner')")
    .run(email.toLowerCase(), name, await hashPassword(password));
  console.log(`[staff] created admin dashboard owner account for ${email}`);
}
