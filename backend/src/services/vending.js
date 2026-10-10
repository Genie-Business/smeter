// Purchase lifecycle:
//   pending ──payment verified──▶ paid ──token minted──▶ vended
//      │                           │ (head-end failure: stays paid, retried by the sweeper)
//      └──payment failed──▶ failed  └──────────────────▶ …
// Every transition is a conditional UPDATE on the current status, so duplicate
// webhooks, the redirect callback and the sweeper can race safely (idempotent).
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { db, now } from '../db.js';
import { geni } from '../geni/index.js';
import { payments } from '../providers/payments.js';
import { badRequest, notFound, upstream } from '../util/errors.js';
import { koboToNaira } from '../util/http.js';
import { notify } from './notifications.js';
import { quote } from './pricing.js';

const naira = (kobo) => `₦${koboToNaira(kobo).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;

export function newReference() {
  return `SM${Date.now().toString(36).toUpperCase()}${randomBytes(4).toString('hex').toUpperCase()}`;
}

export function quoteFor(meter, landlord, amountKobo) {
  return quote({
    amountKobo,
    unitPriceKobo: landlord.unit_price_kobo,
    baseCostKobo: Math.round(config.tariff.baseUnitCostNaira * 100),
    feeBearer: landlord.fee_bearer,
    debtKobo: meter.debt_kobo,
    debtPercent: meter.debt_recovery_percent,
  });
}

export async function createPurchase({ meter, landlord, amountKobo, initiatedBy, email, channel }) {
  if (meter.status !== 'active' && initiatedBy === 'tenant') throw badRequest('This meter is not active yet');
  const q = quoteFor(meter, landlord, amountKobo);
  const reference = newReference();
  const provider = payments();

  db()
    .prepare(
      `INSERT INTO purchases (reference, meter_id, landlord_id, initiated_by, amount_kobo, debt_kobo, energy_kobo,
         fee_kobo, fee_bearer, total_kobo, landlord_net_kobo, unit_price_kobo, base_cost_kobo, provider)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      reference, meter.meter_id, landlord.id, initiatedBy, q.amountKobo, q.debtKobo, q.energyKobo,
      q.feeKobo, q.feeBearer, q.totalKobo, q.landlordNetKobo, landlord.unit_price_kobo, q.baseKobo, provider.name,
    );

  let init;
  try {
    init = await provider.initialize({
      reference,
      amountKobo: q.totalKobo,
      email: email || meter.tenant_email || `${meter.meter_id}@tenants.smeter.app`,
      callbackUrl: `${config.publicUrl}/pay/return?reference=${encodeURIComponent(reference)}`,
      channels: channel ? [channel] : config.payments.channels,
      metadata: { meterId: meter.meter_id, landlordId: landlord.id, units: q.units },
      split: landlord.settlement_ref
        ? {
            subaccount: landlord.settlement_ref,
            platformShareKobo: q.platformShareKobo,
            bearer: q.feeBearer === 'landlord' ? 'subaccount' : 'account',
          }
        : undefined,
    });
  } catch (err) {
    setStatus(reference, 'pending', 'failed', { failure_reason: `Checkout could not start: ${err.message}` });
    throw upstream('Could not start checkout, please try again');
  }
  db()
    .prepare('UPDATE purchases SET authorization_url = ?, updated_at = ? WHERE reference = ?')
    .run(init.authorizationUrl, now(), reference);
  return { reference, authorizationUrl: init.authorizationUrl, quote: q };
}

function setStatus(reference, from, to, extra = {}) {
  const cols = Object.keys(extra);
  const sets = ['status = ?', 'updated_at = ?', ...cols.map((c) => `${c} = ?`)].join(', ');
  const fromList = Array.isArray(from) ? from : [from];
  const res = db()
    .prepare(`UPDATE purchases SET ${sets} WHERE reference = ? AND status IN (${fromList.map(() => '?').join(',')})`)
    .run(to, now(), ...cols.map((c) => extra[c]), reference, ...fromList);
  return res.changes === 1;
}

export function getPurchase(reference) {
  return db().prepare('SELECT * FROM purchases WHERE reference = ?').get(reference);
}

/**
 * Confirm a payment with the gateway and, if successful, vend. Safe to call any
 * number of times for the same reference.
 */
export async function settlePayment(reference, { source = 'callback' } = {}) {
  const purchase = getPurchase(reference);
  if (!purchase) throw notFound('Unknown payment reference');
  if (purchase.status !== 'pending') {
    if (purchase.status === 'paid') await vend(reference);
    return getPurchase(reference);
  }

  const result = await payments().verify(reference);
  if (result.status === 'success') {
    if (result.amountKobo < purchase.total_kobo) {
      setStatus(reference, 'pending', 'failed', { failure_reason: 'Amount paid does not match the order total' });
      notify({
        recipientType: 'landlord', recipientId: purchase.landlord_id, kind: 'audit',
        title: 'Payment amount mismatch',
        body: `Payment ${reference} for meter ${purchase.meter_id} was short-paid. Manual review needed.`,
      });
      return getPurchase(reference);
    }
    if (setStatus(reference, 'pending', 'paid', { paid_at: now() }) && source === 'audit') {
      notify({
        recipientType: 'landlord', recipientId: purchase.landlord_id, kind: 'audit',
        title: 'Late payment reconciled',
        body: `No webhook arrived for ${reference} within ${config.payments.auditAfterMinutes} minutes; it was verified and reconciled automatically.`,
      });
    }
    await vend(reference);
  } else if (result.status === 'failed') {
    setStatus(reference, 'pending', 'failed', { failure_reason: result.gatewayResponse || 'Payment was not completed' });
  }
  return getPurchase(reference);
}

/** Mint the STS token for a paid purchase and deliver it to the meter. */
export async function vend(reference) {
  if (!setStatus(reference, 'paid', 'vending')) return getPurchase(reference);
  const p = getPurchase(reference);
  const meter = db().prepare('SELECT * FROM meters WHERE meter_id = ?').get(p.meter_id);
  const client = geni();

  let minted;
  try {
    minted = await client.vendCredit({
      meterId: p.meter_id,
      amountNaira: koboToNaira(p.energy_kobo),
      serialNumber: p.reference,
    });
  } catch (err) {
    setStatus(reference, 'vending', 'paid', { failure_reason: `Token generation failed: ${err.message}` });
    notify({
      recipientType: 'landlord', recipientId: p.landlord_id, kind: 'vend_failed',
      title: 'Token generation delayed',
      body: `Payment ${reference} for meter ${p.meter_id} succeeded but the token could not be generated yet. Retrying automatically.`,
    });
    return getPurchase(reference);
  }

  // Over-the-air delivery when the meter uses GPRS and is online. Otherwise the
  // tenant keys the token into the meter remote (the app shows it on the receipt).
  const manualMode = meter?.delivery_mode === 'manual';
  let delivery = 'manual';
  let taskId = null;
  if (config.geni.pushTokensOta && !manualMode) {
    try {
      const status = await client.onlineStatus(p.meter_id);
      if (status.online) {
        const task = await client.pushToken({ customerId: meter?.customer_id, meterId: p.meter_id, token: minted.token });
        delivery = 'ota_queued';
        taskId = task.taskId;
      }
    } catch (err) {
      console.error('[vend] OTA push failed, falling back to manual token', err.message);
    }
  }

  db().exec('BEGIN IMMEDIATE');
  try {
    setStatus(reference, 'vending', 'vended', {
      token: minted.token,
      units: minted.units,
      receipt_id: minted.receiptId,
      delivery,
      delivery_task_id: taskId,
      vended_at: now(),
      failure_reason: null,
    });
    if (p.debt_kobo > 0) {
      db()
        .prepare('UPDATE meters SET debt_kobo = MAX(0, debt_kobo - ?) WHERE meter_id = ?')
        .run(p.debt_kobo, p.meter_id);
    }
    db().exec('COMMIT');
  } catch (err) {
    db().exec('ROLLBACK');
    throw err;
  }

  const units = `${minted.units.toFixed(2)} kWh`;
  notify({
    recipientType: 'tenant', recipientId: p.meter_id, kind: 'vended',
    title: delivery === 'manual' ? 'Your token is ready' : 'Power units on the way',
    body: delivery === 'ota_queued'
      ? `${units} for ${naira(p.amount_kobo)} is being sent to your meter.`
      : manualMode
        ? `Enter ${formatToken(minted.token)} on your meter remote to load ${units}.`
        : `Your meter is offline. Enter ${formatToken(minted.token)} on your meter remote to load ${units}.`,
  });
  notify({
    recipientType: 'landlord', recipientId: p.landlord_id, kind: 'payment',
    title: 'Payment received',
    body: `Meter ${p.meter_id} bought ${units} for ${naira(p.amount_kobo)}.`,
  });
  return getPurchase(reference);
}

export const formatToken = (token) => String(token ?? '').replace(/(\d{4})(?=\d)/g, '$1-');

export function purchaseDto(p, { includeToken = true } = {}) {
  return {
    reference: p.reference,
    meterId: p.meter_id,
    status: p.status,
    initiatedBy: p.initiated_by,
    amount: koboToNaira(p.amount_kobo),
    debtRecovered: koboToNaira(p.debt_kobo),
    energyAmount: koboToNaira(p.energy_kobo),
    fee: koboToNaira(p.fee_kobo),
    feeBearer: p.fee_bearer,
    total: koboToNaira(p.total_kobo),
    unitPrice: koboToNaira(p.unit_price_kobo),
    units: p.units,
    token: includeToken && p.token ? formatToken(p.token) : null,
    delivery: p.delivery,
    receiptId: p.receipt_id,
    failureReason: p.failure_reason,
    createdAt: p.created_at,
    vendedAt: p.vended_at,
  };
}

/** Landlord view adds the settlement split. */
export function landlordPurchaseDto(p) {
  return {
    ...purchaseDto(p),
    landlordNet: koboToNaira(p.landlord_net_kobo),
    baseCost: koboToNaira(p.base_cost_kobo),
    markup: koboToNaira(p.energy_kobo - p.base_cost_kobo),
  };
}
