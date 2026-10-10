import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { db, now } from '../db.js';
import { requireLandlord } from '../auth/middleware.js';
import { consumeOtp, issueOtp, otpEcho } from '../auth/otp.js';
import { asUpstream } from '../geni/client.js';
import { geni } from '../geni/index.js';
import { payments } from '../providers/payments.js';
import { sendSms } from '../providers/sms.js';
import { listNotifications, markAllRead, notify, unreadCount } from '../services/notifications.js';
import { liveReading } from '../services/usage.js';
import { createPurchase, getPurchase, landlordPurchaseDto, settlePayment, vend } from '../services/vending.js';
import { badRequest, conflict, notFound, upstream } from '../util/errors.js';
import { koboToNaira, nairaToKobo, pageParams, parse } from '../util/http.js';
import { maskPhone, normalizePhone } from '../util/phone.js';
import { landlordDto, meterDto } from './dto.js';

export const landlordRoutes = Router();
landlordRoutes.use(requireLandlord());

const reload = (id) => db().get('SELECT * FROM landlords WHERE id = ?', id);
const tariffIdFor = (landlord) => landlord.tariff_id ?? `SML${String(landlord.id).padStart(6, '0')}`;

/** Make sure the landlord's tariff exists on the head-end with their price. */
async function syncTariff(landlord) {
  const tariffId = tariffIdFor(landlord);
  const price = koboToNaira(landlord.unit_price_kobo || Math.round(config.tariff.baseUnitCostNaira * 100));
  await geni().upsertTariff({ tariffId, tariffName: `${landlord.full_name} (smeter)`.slice(0, 60), price, tax: 0 });
  if (!landlord.tariff_id) await db().run('UPDATE landlords SET tariff_id = ? WHERE id = ?', tariffId, landlord.id);
  return tariffId;
}

async function ownedMeter(landlord, meterId) {
  const meter = await db().get(
    "SELECT * FROM meters WHERE meter_id = ? AND landlord_id = ? AND status != 'removed'",
    meterId, landlord.id,
  );
  if (!meter) throw notFound('Meter not found');
  return meter;
}

// ---- Profile ---------------------------------------------------------------

landlordRoutes.get('/me', (req, res) => {
  res.json({ landlord: landlordDto(req.landlord) });
});

landlordRoutes.patch('/me', async (req, res) => {
  const body = parse(
    z.object({
      fullName: z.string().trim().min(2).max(120).optional(),
      address: z.string().trim().max(240).optional(),
    }),
    req.body,
  );
  await db().run(
    'UPDATE landlords SET full_name = COALESCE(?, full_name), address = COALESCE(?, address) WHERE id = ?',
    body.fullName ?? null, body.address ?? null, req.landlord.id,
  );
  res.json({ landlord: landlordDto(await reload(req.landlord.id)) });
});

// ---- Dashboard -------------------------------------------------------------

landlordRoutes.get('/dashboard', async (req, res) => {
  const id = req.landlord.id;
  const [totals, month, meters, recent, unread] = await Promise.all([
    db().get(
      `SELECT COALESCE(SUM(total_kobo), 0) AS collected, COALESCE(SUM(landlord_net_kobo), 0) AS net, COUNT(*) AS count
       FROM purchases WHERE landlord_id = ? AND status = 'vended'`,
      id,
    ),
    db().get(
      `SELECT COALESCE(SUM(landlord_net_kobo), 0) AS net FROM purchases
       WHERE landlord_id = ? AND status = 'vended' AND vended_at >= ?`,
      id, new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString(),
    ),
    db().get(
      `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'active') AS active,
         COUNT(*) FILTER (WHERE status = 'invited') AS invited
       FROM meters WHERE landlord_id = ? AND status != 'removed'`,
      id,
    ),
    db().all(`SELECT * FROM purchases WHERE landlord_id = ? AND status != 'abandoned' ORDER BY id DESC LIMIT 6`, id),
    unreadCount('landlord', id),
  ]);
  res.json({
    landlord: landlordDto(req.landlord),
    earnings: koboToNaira(totals.net),
    earningsThisMonth: koboToNaira(month.net),
    collected: koboToNaira(totals.collected),
    purchaseCount: totals.count,
    meters: { total: meters.total, active: meters.active ?? 0, invited: meters.invited ?? 0 },
    unreadNotifications: unread,
    recent: recent.map(landlordPurchaseDto),
  });
});

// ---- Tariff & fees (SM-FIN-001, SM-PAY-004) --------------------------------

landlordRoutes.put('/tariff', async (req, res) => {
  const { unitPrice } = parse(z.object({ unitPrice: z.coerce.number().positive('Enter a price per kWh') }), req.body);
  if (unitPrice > config.tariff.maxUnitPriceNaira) {
    throw badRequest(`The regulated maximum is ₦${config.tariff.maxUnitPriceNaira} per kWh`);
  }
  if (unitPrice < config.tariff.baseUnitCostNaira) {
    throw badRequest(`Price can't be below the utility cost of ₦${config.tariff.baseUnitCostNaira} per kWh`);
  }
  const previous = req.landlord.unit_price_kobo;
  await db().run('UPDATE landlords SET unit_price_kobo = ? WHERE id = ?', nairaToKobo(unitPrice), req.landlord.id);
  const landlord = await reload(req.landlord.id);
  try {
    await syncTariff(landlord);
  } catch (err) {
    await db().run('UPDATE landlords SET unit_price_kobo = ? WHERE id = ?', previous, req.landlord.id);
    throw asUpstream(err);
  }
  const tenants = await db().all("SELECT meter_id FROM meters WHERE landlord_id = ? AND status = 'active'", landlord.id);
  for (const t of tenants) {
    await notify({
      recipientType: 'tenant', recipientId: t.meter_id, kind: 'tariff',
      title: 'Unit price updated',
      body: `Power now costs ₦${unitPrice.toFixed(2)} per kWh on your meter.`,
    });
  }
  res.json({ landlord: landlordDto(landlord) });
});

landlordRoutes.put('/fee-bearer', async (req, res) => {
  const { feeBearer } = parse(z.object({ feeBearer: z.enum(['tenant', 'landlord']) }), req.body);
  await db().run('UPDATE landlords SET fee_bearer = ? WHERE id = ?', feeBearer, req.landlord.id);
  res.json({ landlord: landlordDto(await reload(req.landlord.id)) });
});

// ---- Settlement bank account (SM-ONB-001) ----------------------------------

landlordRoutes.get('/banks', async (_req, res) => {
  res.json({ banks: await payments().listBanks() });
});

/** Rough "same person" check: at least two name tokens (or all of a short name) overlap. */
export function namesMatch(profileName, accountName) {
  const tokens = (s) => new Set(String(s).toUpperCase().replace(/[^A-Z\s]/g, ' ').split(/\s+/).filter((t) => t.length > 1));
  const a = tokens(profileName);
  const b = tokens(accountName);
  const overlap = [...a].filter((t) => b.has(t)).length;
  return overlap >= Math.min(2, a.size);
}

async function resolveBank(landlord, bankCode, accountNumber) {
  try {
    const p = payments();
    return p.name === 'mock'
      ? await p.resolveAccount({ accountNumber, bankCode }, landlord.full_name)
      : await p.resolveAccount({ accountNumber, bankCode });
  } catch (err) {
    throw badRequest(`Could not verify that account: ${err.message}`);
  }
}

const bankBody = z.object({
  bankCode: z.string().trim().min(2),
  bankName: z.string().trim().min(2).max(80),
  accountNumber: z.string().trim().regex(/^\d{10}$/, 'Account number must be 10 digits'),
});

landlordRoutes.post('/bank/resolve', async (req, res) => {
  const body = parse(bankBody, req.body);
  const { accountName } = await resolveBank(req.landlord, body.bankCode, body.accountNumber);
  res.json({ accountName, matchesProfile: namesMatch(req.landlord.full_name, accountName) });
});

// Step 1: verify the account name, then send an OTP (2FA) before saving.
landlordRoutes.post('/bank/request', async (req, res) => {
  const body = parse(bankBody, req.body);
  const { accountName } = await resolveBank(req.landlord, body.bankCode, body.accountNumber);
  if (!namesMatch(req.landlord.full_name, accountName)) {
    throw badRequest(`The account name "${accountName}" doesn't match your profile name. Use an account in your name.`);
  }
  const code = await issueOtp({
    purpose: 'bank_update',
    subject: String(req.landlord.id),
    payload: { ...body, accountName },
  });
  await sendSms(req.landlord.phone, `Your smeter code to change your payout account is ${code}. Don't share it with anyone.`);
  res.json({ accountName, sentTo: maskPhone(req.landlord.phone), ...otpEcho(code) });
});

// Step 2: confirm the OTP, register the settlement account, save.
landlordRoutes.post('/bank/confirm', async (req, res) => {
  const { code } = parse(z.object({ code: z.string().trim() }), req.body);
  const pending = await consumeOtp({ purpose: 'bank_update', subject: String(req.landlord.id), code });
  let settlementRef;
  try {
    ({ settlementRef } = await payments().createSettlementAccount({
      businessName: req.landlord.full_name,
      bankCode: pending.bankCode,
      accountNumber: pending.accountNumber,
    }));
  } catch (err) {
    throw upstream(`Could not register the payout account: ${err.message}`);
  }
  await db().run(
    `UPDATE landlords SET bank_name = ?, bank_code = ?, account_number = ?, account_name = ?,
       bank_verified_at = ?, settlement_ref = ? WHERE id = ?`,
    pending.bankName, pending.bankCode, pending.accountNumber, pending.accountName, now(), settlementRef, req.landlord.id,
  );
  await notify({
    recipientType: 'landlord', recipientId: req.landlord.id, kind: 'security',
    title: 'Payout account changed',
    body: `Vending revenue now settles to ${pending.bankName} ••••${pending.accountNumber.slice(-4)}.`,
  });
  res.json({ landlord: landlordDto(await reload(req.landlord.id)) });
});

// ---- Meters / tenancy (SM-TNS-001) -----------------------------------------

landlordRoutes.get('/meters', async (req, res) => {
  const meters = await db().all("SELECT * FROM meters WHERE landlord_id = ? AND status != 'removed' ORDER BY id DESC", req.landlord.id);
  res.json({ meters: meters.map(meterDto) });
});

const meterBody = z.object({
  meterId: z.string().trim().regex(/^\d{6,20}$/, 'Enter the serial number printed on the meter'),
  address: z.string().trim().min(3, 'Enter the property address').max(240),
  apartment: z.string().trim().max(40).optional().default(''),
  tenantPhone: z.string(),
  tenantFirstName: z.string().trim().max(60).optional(),
  tenantLastName: z.string().trim().max(60).optional(),
  debtAmount: z.coerce.number().min(0).max(10_000_000).optional().default(0),
  debtRecoveryPercent: z.coerce.number().min(0).max(100).optional().default(0),
  deliveryMode: z.enum(['ota', 'manual']).optional().default('ota'),
});

landlordRoutes.post('/meters', async (req, res) => {
  const body = parse(meterBody, req.body);
  const tenantPhone = normalizePhone(body.tenantPhone);
  if (!tenantPhone) throw badRequest("Enter the tenant's phone number", { tenantPhone: 'Invalid phone number' });

  const existing = await db().get('SELECT * FROM meters WHERE meter_id = ?', body.meterId);
  if (existing && existing.status !== 'removed') {
    throw conflict(
      existing.landlord_id === req.landlord.id
        ? 'You have already added this meter'
        : 'This meter is already assigned to another active tenant',
    );
  }

  // Validate the hardware id against the manufacturer's records, then bind it
  // to a customer + this landlord's tariff on the head-end.
  const client = geni();
  const customerId = `SMC${body.meterId}`;
  let info;
  try {
    info = await client.getMeter(body.meterId);
    if (!info) throw badRequest("We couldn't find that meter serial number. Check the number on the meter.");
    const tariffId = await syncTariff(req.landlord);
    const name = [body.tenantFirstName, body.tenantLastName].filter(Boolean).join(' ') || `Apt ${body.apartment || body.meterId}`;
    await client.upsertCustomer({ customerId, customerName: name, phone: tenantPhone, address: body.address });
    await client.bindAccount({ customerId, meterId: body.meterId, region: body.address.slice(0, 60), tariffId });
  } catch (err) {
    throw asUpstream(err);
  }

  const values = [
    req.landlord.id, body.address, body.apartment, body.tenantFirstName ?? null, body.tenantLastName ?? null,
    tenantPhone, info.isThreePhase ? 1 : 0, customerId, nairaToKobo(body.debtAmount), body.debtRecoveryPercent,
    body.deliveryMode,
  ];
  if (existing) {
    // Only re-claim a meter that is still removed (another owner may have raced us).
    const r = await db().run(
      `UPDATE meters SET landlord_id = ?, address = ?, apartment = ?, tenant_first_name = ?, tenant_last_name = ?,
         tenant_phone = ?, is_three_phase = ?, customer_id = ?, debt_kobo = ?, debt_recovery_percent = ?,
         delivery_mode = ?, tenant_email = NULL, status = 'invited', accepted_at = NULL, relay_state = 'connected'
       WHERE meter_id = ? AND status = 'removed'`,
      ...values, body.meterId,
    );
    if (r.changes !== 1) throw conflict('This meter is already assigned to another active tenant');
  } else {
    try {
      await db().run(
        `INSERT INTO meters (landlord_id, address, apartment, tenant_first_name, tenant_last_name, tenant_phone,
           is_three_phase, customer_id, debt_kobo, debt_recovery_percent, delivery_mode, meter_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ...values, body.meterId,
      );
    } catch (err) {
      if (err.code === '23505') throw conflict('This meter is already assigned to another active tenant');
      throw err;
    }
  }
  await sendSms(
    tenantPhone,
    `${req.landlord.full_name} added your meter ${body.meterId} to smeter. Get the smeter app and sign in with your meter number to buy power and track usage.`,
  );
  const meter = await db().get('SELECT * FROM meters WHERE meter_id = ?', body.meterId);
  res.status(201).json({ meter: meterDto(meter) });
});

landlordRoutes.get('/meters/:meterId', async (req, res) => {
  const meter = await ownedMeter(req.landlord, req.params.meterId);
  const purchases = await db().all(
    `SELECT * FROM purchases WHERE meter_id = ? AND landlord_id = ? ORDER BY id DESC LIMIT 20`,
    meter.meter_id, req.landlord.id,
  );
  let live = null;
  try {
    live = await liveReading(meter);
  } catch {
    /* head-end unreachable: show the meter without live data */
  }
  res.json({ meter: meterDto(meter), live, purchases: purchases.map(landlordPurchaseDto) });
});

landlordRoutes.patch('/meters/:meterId', async (req, res) => {
  const meter = await ownedMeter(req.landlord, req.params.meterId);
  const body = parse(
    z.object({
      address: z.string().trim().min(3).max(240).optional(),
      apartment: z.string().trim().max(40).optional(),
      debtAmount: z.coerce.number().min(0).max(10_000_000).optional(),
      debtRecoveryPercent: z.coerce.number().min(0).max(100).optional(),
      deliveryMode: z.enum(['ota', 'manual']).optional(),
    }),
    req.body,
  );
  await db().run(
    `UPDATE meters SET address = COALESCE(?, address), apartment = COALESCE(?, apartment),
       debt_kobo = COALESCE(?, debt_kobo), debt_recovery_percent = COALESCE(?, debt_recovery_percent),
       delivery_mode = COALESCE(?, delivery_mode)
     WHERE id = ?`,
    body.address ?? null,
    body.apartment ?? null,
    body.debtAmount === undefined ? null : nairaToKobo(body.debtAmount),
    body.debtRecoveryPercent ?? null,
    body.deliveryMode ?? null,
    meter.id,
  );
  if (body.deliveryMode && body.deliveryMode !== meter.delivery_mode) {
    await notify({
      recipientType: 'tenant', recipientId: meter.meter_id, kind: 'mode',
      title: body.deliveryMode === 'manual' ? 'Tokens now load from your meter remote' : 'Tokens now load automatically',
      body: body.deliveryMode === 'manual'
        ? 'Your property owner switched this meter to manual tokens. After each purchase, enter the token on your meter remote.'
        : 'Your property owner switched this meter to automatic delivery. Units will be sent to your meter after each purchase.',
    });
  }
  res.json({ meter: meterDto(await db().get('SELECT * FROM meters WHERE id = ?', meter.id)) });
});

landlordRoutes.delete('/meters/:meterId', async (req, res) => {
  const meter = await ownedMeter(req.landlord, req.params.meterId);
  await db().run("UPDATE meters SET status = 'removed' WHERE id = ?", meter.id);
  res.json({ ok: true });
});

// Remote kill-switch (SM-ADM-001). The head-end queues the task until the
// meter's next heartbeat if it's offline.
for (const action of ['disconnect', 'reconnect']) {
  landlordRoutes.post(`/meters/:meterId/${action}`, async (req, res) => {
    const meter = await ownedMeter(req.landlord, req.params.meterId);
    if (meter.delivery_mode === 'manual') {
      throw conflict('This meter uses manual tokens (no GPRS link), so it can’t be switched remotely.');
    }
    let online = false;
    try {
      ({ online } = await geni().onlineStatus(meter.meter_id));
      await geni().control({ customerId: meter.customer_id, meterId: meter.meter_id, action });
    } catch (err) {
      throw asUpstream(err);
    }
    const state = action === 'disconnect' ? (online ? 'disconnected' : 'disconnect_pending') : (online ? 'connected' : 'reconnect_pending');
    await db().run('UPDATE meters SET relay_state = ? WHERE id = ?', state, meter.id);
    await notify({
      recipientType: 'tenant', recipientId: meter.meter_id, kind: 'relay',
      title: action === 'disconnect' ? 'Power disconnected' : 'Power reconnected',
      body: action === 'disconnect'
        ? 'Your property owner remotely disconnected supply to this meter. Contact them for help.'
        : 'Supply to your meter has been restored.',
    });
    res.json({ meter: meterDto(await db().get('SELECT * FROM meters WHERE id = ?', meter.id)), queued: !online });
  });
}

// ---- Transactions & payments ------------------------------------------------

landlordRoutes.get('/transactions', async (req, res) => {
  const { pageSize, offset, page } = pageParams(req.query);
  const where = "landlord_id = ? AND status != 'abandoned'";
  const rows = await db().all(`SELECT * FROM purchases WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`, req.landlord.id, pageSize, offset);
  const { n } = await db().get(`SELECT COUNT(*) AS n FROM purchases WHERE ${where}`, req.landlord.id);
  res.json({ data: rows.map(landlordPurchaseDto), page, pageSize, total: n });
});

// "Make a Payment": the owner buys units for one of their meters.
landlordRoutes.post('/purchases', async (req, res) => {
  const body = parse(
    z.object({
      meterId: z.string().trim(),
      amount: z.coerce.number().positive(),
      channel: z.enum(['card', 'bank_transfer', 'ussd']).optional(),
    }),
    req.body,
  );
  const meter = await ownedMeter(req.landlord, body.meterId);
  const result = await createPurchase({
    meter,
    landlord: req.landlord,
    amountKobo: nairaToKobo(body.amount),
    initiatedBy: 'landlord',
    email: req.landlord.email,
    channel: body.channel,
  });
  res.status(201).json({ reference: result.reference, authorizationUrl: result.authorizationUrl, quote: quoteDto(result.quote) });
});

landlordRoutes.get('/purchases/:reference', async (req, res) => {
  let p = await getPurchase(req.params.reference);
  if (!p || p.landlord_id !== req.landlord.id) throw notFound('Transaction not found');
  if (p.status === 'pending' || p.status === 'paid') {
    try {
      p = await settlePayment(p.reference, { source: 'poll' });
    } catch (err) {
      console.error('[landlord] settle on poll failed', err.message);
    }
  }
  res.json({ purchase: landlordPurchaseDto(p) });
});

landlordRoutes.post('/purchases/:reference/retry', async (req, res) => {
  const p = await getPurchase(req.params.reference);
  if (!p || p.landlord_id !== req.landlord.id) throw notFound('Transaction not found');
  if (p.status !== 'paid') throw conflict('Only paid transactions awaiting a token can be retried');
  const after = await vend(p.reference);
  res.json({ purchase: landlordPurchaseDto(after) });
});

// Profit / markup ledger (feature 11).
landlordRoutes.get('/ledger', async (req, res) => {
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const to = req.query.to ? new Date(String(req.query.to)) : new Date();
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) throw badRequest('Invalid date range');
  const rows = await db().all(
    `SELECT meter_id, COUNT(*) AS purchases, SUM(total_kobo) AS collected, SUM(energy_kobo) AS energy,
       SUM(base_cost_kobo) AS base, SUM(debt_kobo) AS debt, SUM(fee_kobo) AS fees,
       SUM(landlord_net_kobo) AS net, SUM(units) AS units
     FROM purchases WHERE landlord_id = ? AND status = 'vended' AND vended_at BETWEEN ? AND ?
     GROUP BY meter_id ORDER BY net DESC`,
    req.landlord.id, from.toISOString(), to.toISOString(),
  );
  const line = (r) => ({
    purchases: r.purchases,
    units: Math.round((r.units ?? 0) * 100) / 100,
    collected: koboToNaira(r.collected ?? 0),
    baseUtilityCost: koboToNaira(r.base ?? 0),
    markup: koboToNaira((r.energy ?? 0) - (r.base ?? 0)),
    debtRecovered: koboToNaira(r.debt ?? 0),
    fees: koboToNaira(r.fees ?? 0),
    net: koboToNaira(r.net ?? 0),
  });
  const sum = (k) => rows.reduce((s, r) => s + (r[k] ?? 0), 0);
  res.json({
    from: from.toISOString(),
    to: to.toISOString(),
    totals: line({
      purchases: sum('purchases'), units: sum('units'), collected: sum('collected'), energy: sum('energy'),
      base: sum('base'), debt: sum('debt'), fees: sum('fees'), net: sum('net'),
    }),
    meters: rows.map((r) => ({ meterId: r.meter_id, ...line(r) })),
  });
});

// ---- Notifications ----------------------------------------------------------

landlordRoutes.get('/notifications', async (req, res) => {
  const [data, unread] = await Promise.all([
    listNotifications('landlord', req.landlord.id),
    unreadCount('landlord', req.landlord.id),
  ]);
  res.json({ data, unread });
});

landlordRoutes.post('/notifications/read', async (req, res) => {
  await markAllRead('landlord', req.landlord.id);
  res.json({ ok: true });
});

export function quoteDto(q) {
  return {
    amount: koboToNaira(q.amountKobo),
    debtRecovered: koboToNaira(q.debtKobo),
    energyAmount: koboToNaira(q.energyKobo),
    units: q.units,
    fee: koboToNaira(q.feeKobo),
    feeBearer: q.feeBearer,
    total: koboToNaira(q.totalKobo),
  };
}
