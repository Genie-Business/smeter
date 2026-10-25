import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db.js';
import { requireTenant } from '../auth/middleware.js';
import { geni } from '../geni/index.js';
import { listNotifications, markAllRead, unreadCount } from '../services/notifications.js';
import { accrueServiceCharge } from '../services/service-charge.js';
import { liveReading, monthSummary, unitsBalance, usageReport } from '../services/usage.js';
import { createPurchase, createServicePayment, getPurchase, purchaseDto, quoteFor, settlePayment } from '../services/vending.js';
import { badRequest, notFound } from '../util/errors.js';
import { koboToNaira, nairaToKobo, pageParams, parse } from '../util/http.js';
import { tenantDto } from './dto.js';
import { quoteDto } from './landlord.js';

export const tenantRoutes = Router();
tenantRoutes.use(requireTenant());

const landlordOf = (meter) => db().get('SELECT * FROM landlords WHERE id = ?', meter.landlord_id);

tenantRoutes.get('/me', async (req, res) => {
  res.json({ tenant: tenantDto(req.meter, await landlordOf(req.meter)) });
});

tenantRoutes.patch('/me', async (req, res) => {
  // Phone and delivery mode are managed by the property owner (login codes go
  // to that phone; the owner knows whether the meter has a GPRS link).
  const body = parse(
    z.object({
      firstName: z.string().trim().max(60).optional(),
      lastName: z.string().trim().max(60).optional(),
      email: z.union([z.string().trim().toLowerCase().email('Enter a valid email address'), z.literal('')]).optional(),
    }),
    req.body,
  );
  await db().run(
    `UPDATE meters SET tenant_first_name = COALESCE(?, tenant_first_name), tenant_last_name = COALESCE(?, tenant_last_name),
       tenant_email = COALESCE(?, tenant_email) WHERE id = ?`,
    body.firstName ?? null, body.lastName ?? null, body.email === undefined ? null : body.email || null, req.meter.id,
  );
  const meter = await db().get('SELECT * FROM meters WHERE id = ?', req.meter.id);
  res.json({ tenant: tenantDto(meter, await landlordOf(meter)) });
});

tenantRoutes.get('/dashboard', async (req, res) => {
  req.meter = await accrueServiceCharge(req.meter); // bills a new month before showing what's due
  const [recent, landlord, last, points, month, unread] = await Promise.all([
    db().all(
      `SELECT * FROM purchases WHERE meter_id = ? AND status IN ('vended','paid','vending','pending')
       ORDER BY id DESC LIMIT 5`,
      req.meter.meter_id,
    ),
    landlordOf(req.meter),
    db().get(
      `SELECT * FROM purchases WHERE meter_id = ? AND status = 'vended' AND token IS NOT NULL ORDER BY vended_at DESC LIMIT 1`,
      req.meter.meter_id,
    ),
    unitsBalance(req.meter),
    monthSummary(req.meter),
    unreadCount('tenant', req.meter.meter_id),
  ]);
  res.json({
    tenant: tenantDto(req.meter, landlord),
    points,
    month,
    lastToken: last ? purchaseDto(last) : null,
    recent: recent.map((p) => purchaseDto(p)),
    unreadNotifications: unread,
  });
});

// Virtual display (SM-MON-001): the app polls this every ~5s while visible.
tenantRoutes.get('/live', async (req, res) => {
  res.json(await liveReading(req.meter));
});

tenantRoutes.get('/usage', async (req, res) => {
  const { period, date } = parse(
    z.object({
      period: z.enum(['day', 'week', 'month', 'year']).default('month'),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }),
    req.query,
  );
  const anchor = date ? new Date(`${date}T12:00:00+01:00`) : new Date();
  if (anchor.getTime() > Date.now() + 24 * 3600 * 1000) throw badRequest('That date is in the future');
  const landlord = await landlordOf(req.meter);
  res.json(await usageReport(req.meter, landlord.unit_price_kobo, period, anchor));
});

const amountBody = z.object({ amount: z.coerce.number().positive('Enter an amount') });
// Enabled channels are checked against the admin's payment settings at purchase time.
export const channelField = z.enum(['card', 'bank_transfer', 'ussd']).optional();

// Tariff visibility + fee breakdown before confirming (features 10, SM-PAY-004).
tenantRoutes.post('/quote', async (req, res) => {
  const { amount } = parse(amountBody, req.body);
  const landlord = await landlordOf(req.meter);
  res.json({ quote: quoteDto(await quoteFor(req.meter, landlord, nairaToKobo(amount))), unitPrice: koboToNaira(landlord.unit_price_kobo) });
});

tenantRoutes.post('/purchases', async (req, res) => {
  const { amount, channel } = parse(amountBody.extend({ channel: channelField }), req.body);
  const result = await createPurchase({
    meter: req.meter,
    landlord: await landlordOf(req.meter),
    amountKobo: nairaToKobo(amount),
    initiatedBy: 'tenant',
    channel,
  });
  res.status(201).json({ reference: result.reference, authorizationUrl: result.authorizationUrl, quote: quoteDto(result.quote) });
});

// Pay the outstanding GPRS service charge on its own (when the tenant pays it).
tenantRoutes.post('/service-charge', async (req, res) => {
  const { channel } = parse(z.object({ channel: channelField }), req.body ?? {});
  const result = await createServicePayment({ meter: req.meter, landlord: await landlordOf(req.meter), channel });
  res.status(201).json({
    reference: result.reference,
    authorizationUrl: result.authorizationUrl,
    amount: koboToNaira(result.amount),
    fee: koboToNaira(result.fee),
    total: koboToNaira(result.total),
  });
});

tenantRoutes.get('/purchases', async (req, res) => {
  const { pageSize, offset, page } = pageParams(req.query);
  const where = "meter_id = ? AND status NOT IN ('abandoned')";
  const rows = await db().all(
    `SELECT * FROM purchases WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    req.meter.meter_id, pageSize, offset,
  );
  const { n } = await db().get(`SELECT COUNT(*) AS n FROM purchases WHERE ${where}`, req.meter.meter_id);
  res.json({ data: rows.map((p) => purchaseDto(p)), page, pageSize, total: n });
});

// Polled by the app after returning from checkout; verifies with the gateway
// if the webhook hasn't landed yet.
tenantRoutes.get('/purchases/:reference', async (req, res) => {
  let p = await getPurchase(req.params.reference);
  if (!p || p.meter_id !== req.meter.meter_id) throw notFound('Purchase not found');
  if (p.status === 'pending' || p.status === 'paid') {
    try {
      p = await settlePayment(p.reference, { source: 'poll' });
    } catch (err) {
      console.error('[tenant] settle on poll failed', err.message);
    }
  }
  res.json({
    purchase: purchaseDto(p),
    address: req.meter.address,
    apartment: req.meter.apartment,
  });
});

tenantRoutes.get('/notifications', async (req, res) => {
  const local = await listNotifications('tenant', req.meter.meter_id);
  // Meter-side events (tamper, low credit, relay and so on) from the head-end.
  let events = [];
  try {
    const raw = await geni().events({
      meterId: req.meter.meter_id,
      from: new Date(Date.now() - 14 * 24 * 3600 * 1000),
      to: new Date(),
    });
    events = raw.map((e, i) => ({
      id: `meter-${i}-${e.at}`,
      kind: 'meter_event',
      title: 'Meter alert',
      body: e.content || `Meter event ${e.code}`,
      read: true,
      createdAt: new Date(e.at).toISOString(),
    }));
  } catch {
    /* head-end unreachable: show local notifications only */
  }
  const data = [...local, ...events].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  res.json({ data, unread: await unreadCount('tenant', req.meter.meter_id) });
});

tenantRoutes.post('/notifications/read', async (req, res) => {
  await markAllRead('tenant', req.meter.meter_id);
  res.json({ ok: true });
});
