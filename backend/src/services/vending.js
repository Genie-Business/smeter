// Purchase lifecycle:
//   pending -> paid      when the payment is verified
//   paid    -> vended    when the token is minted (a head-end failure leaves it
//                        paid, and the sweeper retries)
//   pending -> failed    when the payment fails
// Every transition is a conditional UPDATE on the current status, so duplicate
// webhooks, the redirect callback and the sweeper can race safely (idempotent).
// A service-charge payment (kind 'service') goes paid -> vended with no token.
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { db, now, tx } from '../db.js';
import { geni, geniMode, refreshGeni } from '../geni/index.js';
import { payments } from '../providers/payments.js';
import { badRequest, conflict, notFound, upstream } from '../util/errors.js';
import { koboToNaira } from '../util/http.js';
import { notify } from './notifications.js';
import { grossUp, quote } from './pricing.js';
import { accrueServiceCharge, applyServicePayment, serviceInput } from './service-charge.js';
import { getTariffSettings, paymentParams } from './settings.js';

const naira = (kobo) => `₦${koboToNaira(kobo).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;

export function newReference() {
  return `SM${Date.now().toString(36).toUpperCase()}${randomBytes(4).toString('hex').toUpperCase()}`;
}

/** Price per kWh for a source; source B is only sold when the owner made it prepaid and priced it. */
export function sourcePrice(meter, landlord, source = 'a') {
  if (source !== 'b') return landlord.unit_price_kobo;
  if (!meter.dual_source || !meter.source_b_prepaid) throw badRequest(`${meter.source_b_label || 'This source'} isn’t sold as prepaid on this meter`);
  if (!(landlord.unit_price_b_kobo > 0)) throw conflict(`Your landlord has not set a price for ${meter.source_b_label || 'this source'} yet`);
  return landlord.unit_price_b_kobo;
}

export async function quoteFor(meter, landlord, amountKobo, params, { initiatedBy = 'tenant', source = 'a' } = {}) {
  const b = source === 'b';
  // Source B (the owner's own supply, e.g. a generator): no utility base cost, and the
  // tenant's grid debt and the meter's GPRS service charge stay on source A purchases.
  return quote({
    amountKobo,
    unitPriceKobo: sourcePrice(meter, landlord, source),
    baseCostKobo: b ? 0 : Math.round((await getTariffSettings()).baseUnitCostNaira * 100),
    feeBearer: landlord.fee_bearer,
    debtKobo: b ? 0 : meter.debt_kobo,
    debtPercent: b ? 0 : meter.debt_recovery_percent,
    service: b ? null : await serviceInput(meter, { initiatedBy }),
  }, params ?? (await paymentParams()));
}

// Refuse to take money while the head-end is simulated (production only).
async function requireLiveHeadEnd() {
  await refreshGeni();
  if (config.isProduction && geniMode() !== 'live') {
    throw upstream('Buying power is unavailable right now. Please try again later.');
  }
}

async function startCheckout(reference, init) {
  let result;
  try {
    result = await payments().initialize(init);
  } catch (err) {
    await setStatus(reference, 'pending', 'failed', { failure_reason: `Checkout could not start: ${err.message}` });
    throw upstream('Could not start checkout, please try again');
  }
  await db().run(
    'UPDATE purchases SET authorization_url = ?, updated_at = ? WHERE reference = ?',
    result.authorizationUrl, now(), reference,
  );
  return result;
}

/**
 * The tenant pays the outstanding GPRS service charge on its own (no units).
 * All of it goes to the platform, so there is no owner split.
 */
export async function createServicePayment({ meter, landlord, channel }) {
  const m = await accrueServiceCharge(meter);
  if (m.service_due_kobo <= 0) throw conflict('There is no service charge to pay right now');
  const params = await paymentParams();
  if (channel && !params.channels.includes(channel)) {
    throw badRequest('That payment method isn’t available right now. Choose another one.');
  }
  const due = m.service_due_kobo;
  const total = grossUp(due, params);
  const reference = newReference();
  await db().run(
    `INSERT INTO purchases (reference, meter_id, landlord_id, initiated_by, amount_kobo, debt_kobo, energy_kobo,
       fee_kobo, fee_bearer, total_kobo, landlord_net_kobo, unit_price_kobo, base_cost_kobo, provider, kind, service_kobo)
     VALUES (?, ?, ?, 'tenant', ?, 0, 0, ?, 'tenant', ?, 0, ?, 0, ?, 'service', ?)`,
    reference, m.meter_id, landlord.id, due, total - due, total, landlord.unit_price_kobo, payments().name, due,
  );
  const init = await startCheckout(reference, {
    reference,
    amountKobo: total,
    email: m.tenant_email || `${m.meter_id}@tenants.smeter.app`,
    callbackUrl: `${config.publicUrl}/pay/return?reference=${encodeURIComponent(reference)}`,
    channels: channel ? [channel] : params.channels,
    metadata: { meterId: m.meter_id, landlordId: landlord.id, kind: 'service' },
  });
  return { reference, authorizationUrl: init.authorizationUrl, amount: due, fee: total - due, total };
}

export async function createPurchase({ meter, landlord, amountKobo, initiatedBy, email, channel, source = 'a' }) {
  if (meter.status !== 'active' && initiatedBy === 'tenant') throw badRequest('This meter is not active yet');
  // Never take real money for tokens from the simulated head-end.
  await requireLiveHeadEnd();
  // The power money settles to the owner's payout account; without one it would
  // all land in the company account.
  if (!landlord.settlement_ref) {
    throw conflict(initiatedBy === 'landlord'
      ? 'Add and verify your payout bank account before buying units.'
      : 'Your property owner hasn’t finished setting up payments for this meter yet. Please ask them to add their payout bank account.');
  }
  const params = await paymentParams();
  if (channel && !params.channels.includes(channel)) {
    throw badRequest('That payment method isn’t available right now. Choose another one.');
  }
  const q = await quoteFor(meter, landlord, amountKobo, params, { initiatedBy, source });
  const reference = newReference();

  await db().run(
    `INSERT INTO purchases (reference, meter_id, landlord_id, initiated_by, amount_kobo, debt_kobo, energy_kobo,
       fee_kobo, fee_bearer, total_kobo, landlord_net_kobo, unit_price_kobo, base_cost_kobo, provider,
       service_kobo, service_owner_kobo, service_days, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    reference, meter.meter_id, landlord.id, initiatedBy, q.amountKobo, q.debtKobo, q.energyKobo,
    q.feeKobo, q.feeBearer, q.totalKobo, q.landlordNetKobo, sourcePrice(meter, landlord, source), q.baseKobo, payments().name,
    q.serviceKobo, q.serviceOwnerKobo, q.serviceDays, source,
  );

  const init = await startCheckout(reference, {
    reference,
    amountKobo: q.totalKobo,
    email: email || meter.tenant_email || `${meter.meter_id}@tenants.smeter.app`,
    callbackUrl: `${config.publicUrl}/pay/return?reference=${encodeURIComponent(reference)}`,
    channels: channel ? [channel] : params.channels,
    metadata: { meterId: meter.meter_id, landlordId: landlord.id, units: q.units },
    split: landlord.settlement_ref
      ? {
          subaccount: landlord.settlement_ref,
          platformShareKobo: q.platformShareKobo,
          bearer: q.feeBearer === 'landlord' ? 'subaccount' : 'account',
        }
      : undefined,
  });
  return { reference, authorizationUrl: init.authorizationUrl, quote: q };
}

async function setStatus(reference, from, to, extra = {}) {
  const cols = Object.keys(extra);
  const sets = ['status = ?', 'updated_at = ?', ...cols.map((c) => `${c} = ?`)].join(', ');
  const fromList = Array.isArray(from) ? from : [from];
  const res = await db().run(
    `UPDATE purchases SET ${sets} WHERE reference = ? AND status IN (${fromList.map(() => '?').join(',')})`,
    to, now(), ...cols.map((c) => extra[c]), reference, ...fromList,
  );
  return res.changes === 1;
}

export function getPurchase(reference) {
  return db().get('SELECT * FROM purchases WHERE reference = ?', reference);
}

/**
 * Confirm a payment with the gateway and, if successful, vend. Safe to call any
 * number of times for the same reference.
 */
export async function settlePayment(reference, { source = 'callback' } = {}) {
  const purchase = await getPurchase(reference);
  if (!purchase) throw notFound('Unknown payment reference');
  if (purchase.status !== 'pending') {
    if (purchase.status === 'paid') await vend(reference);
    return getPurchase(reference);
  }

  const result = await payments().verify(reference);
  if (result.status === 'success') {
    if (result.amountKobo < purchase.total_kobo) {
      await setStatus(reference, 'pending', 'failed', { failure_reason: 'Amount paid does not match the order total' });
      await notify({
        recipientType: 'landlord', recipientId: purchase.landlord_id, kind: 'audit',
        title: 'Payment amount mismatch',
        body: `Payment ${reference} for meter ${purchase.meter_id} was short-paid. Manual review needed.`,
      });
      return getPurchase(reference);
    }
    if ((await setStatus(reference, 'pending', 'paid', { paid_at: now() })) && source === 'audit') {
      await notify({
        recipientType: 'landlord', recipientId: purchase.landlord_id, kind: 'audit',
        title: 'Late payment reconciled',
        body: `No webhook arrived for ${reference} within ${(await paymentParams()).auditAfterMinutes} minutes; it was verified and reconciled automatically.`,
      });
    }
    await vend(reference);
  } else if (result.status === 'failed') {
    await setStatus(reference, 'pending', 'failed', { failure_reason: result.gatewayResponse || 'Payment was not completed' });
  }
  return getPurchase(reference);
}

/** Mint the STS token for a paid purchase and deliver it to the meter. */
export async function vend(reference) {
  if (!(await setStatus(reference, 'paid', 'vending'))) return getPurchase(reference);
  const p = await getPurchase(reference);
  if (p.kind === 'service') {
    await tx(async () => {
      await setStatus(reference, 'vending', 'vended', { vended_at: now(), units: 0, failure_reason: null });
      await applyServicePayment(p);
    });
    await notify({
      recipientType: 'tenant', recipientId: p.meter_id, kind: 'service',
      title: 'Service charge paid',
      body: `Thanks, ${naira(p.service_kobo)} service charge received. Your meter stays connected.`,
    });
    return getPurchase(reference);
  }
  const meter = await db().get('SELECT * FROM meters WHERE meter_id = ?', p.meter_id);
  const client = geni();

  let minted;
  try {
    minted = await client.vendCredit({
      meterId: p.meter_id,
      amountNaira: koboToNaira(p.energy_kobo),
      serialNumber: p.reference,
      source: p.source,
    });
  } catch (err) {
    await setStatus(reference, 'vending', 'paid', { failure_reason: `Token generation failed: ${err.message}` });
    await notify({
      recipientType: 'landlord', recipientId: p.landlord_id, kind: 'vend_failed',
      title: 'Token generation delayed',
      body: `Payment ${reference} for meter ${p.meter_id} succeeded but the token could not be generated yet. Retrying automatically.`,
    });
    return getPurchase(reference);
  }

  // Over-the-air delivery for GPRS meters. The head-end holds the task until an
  // offline meter reconnects, so the token is sent either way; the tenant can
  // also key it in from the receipt (a meter ignores a token it has already used).
  const manualMode = meter?.delivery_mode === 'manual';
  let delivery = 'manual';
  let taskId = null;
  let online = true;
  if (config.geni.pushTokensOta && !manualMode) {
    try {
      online = (await client.onlineStatus(p.meter_id).catch(() => ({ online: false }))).online;
      const task = await client.pushToken({ customerId: meter?.customer_id, meterId: p.meter_id, token: minted.token });
      delivery = 'ota_queued';
      taskId = task.taskId;
    } catch (err) {
      console.error('[vend] OTA push failed, falling back to manual token', err.message);
    }
  }

  await tx(async () => {
    await setStatus(reference, 'vending', 'vended', {
      token: minted.token,
      units: minted.units,
      receipt_id: minted.receiptId,
      delivery,
      delivery_task_id: taskId,
      vended_at: now(),
      failure_reason: null,
    });
    if (p.debt_kobo > 0) {
      await db().run('UPDATE meters SET debt_kobo = GREATEST(0, debt_kobo - ?) WHERE meter_id = ?', p.debt_kobo, p.meter_id);
    }
    await applyServicePayment(p);
  });

  const units = `${minted.units.toFixed(2)} kWh`;
  await notify({
    recipientType: 'tenant', recipientId: p.meter_id, kind: 'vended',
    title: delivery === 'manual' ? 'Your token is ready' : 'Power units on the way',
    body: delivery === 'ota_queued'
      ? online
        ? `${units} for ${naira(p.amount_kobo)} is being sent to your meter.`
        : `Your meter is offline, so ${units} will load when it reconnects. To load it now, enter ${formatToken(minted.token)} on your meter remote.`
      : manualMode
        ? `Enter ${formatToken(minted.token)} on your meter remote to load ${units}.`
        : `Your meter is offline. Enter ${formatToken(minted.token)} on your meter remote to load ${units}.`,
  });
  await notify({
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
    kind: p.kind ?? 'units',
    source: p.source ?? 'a',
    initiatedBy: p.initiated_by,
    amount: koboToNaira(p.amount_kobo),
    debtRecovered: koboToNaira(p.debt_kobo),
    energyAmount: koboToNaira(p.energy_kobo),
    fee: koboToNaira(p.fee_kobo),
    feeBearer: p.fee_bearer,
    serviceCharge: koboToNaira((p.service_kobo ?? 0) - (p.service_owner_kobo ?? 0)), // paid by the buyer
    serviceDays: p.service_days ?? 0,
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
    ownerServiceCharge: koboToNaira(p.service_owner_kobo ?? 0), // taken from the owner's share
    baseCost: koboToNaira(p.base_cost_kobo),
    markup: koboToNaira(p.energy_kobo - p.base_cost_kobo),
  };
}
