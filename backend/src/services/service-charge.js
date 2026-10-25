// GPRS service charge: a monthly fee that keeps an automatic-delivery (GPRS)
// meter online. The owner picks who pays when they choose GPRS:
//   owner:               billed monthly, deducted from the owner's share of tenant purchases
//   tenant_monthly:      billed monthly; the tenant pays it on its own, or any unpaid
//                        months are added to their next purchase
//   tenant_per_purchase: each purchase pays for the days its units should last
// meters.service_billed_until is the date the meter is billed through, so
// switching between options never bills the same days twice. Unpaid charges are
// kept per payer (service_owner_due_kobo / service_due_kobo), so a switch never
// moves one party's balance onto the other.
import { db } from '../db.js';
import { koboToNaira } from '../util/http.js';
import { notify } from './notifications.js';
import { getTariffSettings, tariffNow } from './settings.js';

const DAY = 24 * 60 * 60 * 1000;
export const SERVICE_PAYERS = ['owner', 'tenant_monthly', 'tenant_per_purchase'];

const naira = (kobo) => `₦${koboToNaira(kobo).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
const isGprs = (meter) => meter.delivery_mode === 'ota';
const billedMonthly = (meter) => meter.service_payer !== 'tenant_per_purchase';

const feeFrom = (t, meter) => Math.round((meter.is_three_phase ? t.gprsFeeThreePhaseNaira : t.gprsFeeSinglePhaseNaira) * 100);
export const monthlyFeeKobo = async (meter) => feeFrom(await getTariffSettings(), meter);

function addMonths(iso, n) {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString();
}

/**
 * Bill any months that have started for a monthly-billed GPRS meter, a month
 * ahead. Returns the up-to-date meter row.
 */
export async function accrueServiceCharge(meter, nowTs = Date.now()) {
  if (meter.status !== 'active' || !isGprs(meter) || !billedMonthly(meter)) return meter;
  let until = meter.service_billed_until ?? new Date(nowTs).toISOString();
  let months = 0;
  while (new Date(until).getTime() <= nowTs && months < 12) {
    until = addMonths(until, 1);
    months += 1;
  }
  if (!months) return meter;
  const fee = await monthlyFeeKobo(meter);
  const owner = meter.service_payer === 'owner';
  const col = owner ? 'service_owner_due_kobo' : 'service_due_kobo';
  // Conditional on the old value so concurrent requests bill a month once.
  const r = await db().run(
    `UPDATE meters SET ${col} = ${col} + ?, service_billed_until = ?
     WHERE id = ? AND service_billed_until IS NOT DISTINCT FROM ?`,
    fee * months, until, meter.id, meter.service_billed_until,
  );
  const fresh = await db().get('SELECT * FROM meters WHERE id = ?', meter.id);
  if (r.changes === 1 && fee > 0) {
    const amount = naira(fresh[col]);
    await notify(
      owner
        ? {
            recipientType: 'landlord', recipientId: meter.landlord_id, kind: 'service',
            title: 'Meter service charge',
            body: `The monthly service charge for meter ${meter.meter_id} is ${naira(fee)}. ${amount} will be deducted from your next payments.`,
          }
        : {
            recipientType: 'tenant', recipientId: meter.meter_id, kind: 'service',
            title: 'Service charge due',
            body: `Your meter's monthly service charge is ${naira(fee)} (${amount} due). Pay it from Home, or it will be added to your next purchase.`,
          },
    );
  }
  return fresh;
}

/** Average kWh a day over the last 90 days of purchases, or the typical value. */
export async function dailyKwh(meter, nowTs = Date.now()) {
  const row = await db().get(
    `SELECT COALESCE(SUM(units), 0) AS units, MIN(vended_at) AS first FROM purchases
     WHERE meter_id = ? AND kind = 'units' AND status = 'vended' AND vended_at >= ?`,
    meter.meter_id, new Date(nowTs - 90 * DAY).toISOString(),
  );
  if (row.first && row.units > 0) {
    const days = Math.max(7, (nowTs - new Date(row.first).getTime()) / DAY);
    return row.units / days;
  }
  return (await getTariffSettings()).typicalDailyKwh;
}

/**
 * Pricing input for a purchase (see pricing.serviceCharge). The owner buying for
 * a meter never pays the tenant's outstanding monthly charge.
 */
export async function serviceInput(meter, { initiatedBy = 'tenant' } = {}) {
  const m = await accrueServiceCharge(meter);
  return {
    payer: m.service_payer,
    tenantDueKobo: initiatedBy === 'landlord' ? 0 : m.service_due_kobo,
    ownerDueKobo: m.service_owner_due_kobo,
    monthlyFeeKobo: await monthlyFeeKobo(m),
    dailyKwh: m.service_payer === 'tenant_per_purchase' ? await dailyKwh(m) : 0,
    perPurchase: isGprs(m),
  };
}

/** Record a collected service charge on the meter (inside the vend transaction). */
export async function applyServicePayment(purchase) {
  if (!purchase.service_kobo) return;
  const ownerPart = purchase.service_owner_kobo ?? 0;
  const meter = await db().get('SELECT service_billed_until FROM meters WHERE meter_id = ?', purchase.meter_id);
  let until = meter?.service_billed_until ?? null;
  if (purchase.service_days > 0) {
    const from = Math.max(Date.now(), until ? new Date(until).getTime() : 0);
    until = new Date(from + purchase.service_days * DAY).toISOString();
  }
  await db().run(
    `UPDATE meters SET service_owner_due_kobo = GREATEST(0, service_owner_due_kobo - ?),
       service_due_kobo = GREATEST(0, service_due_kobo - ?), service_billed_until = ? WHERE meter_id = ?`,
    ownerPart, purchase.service_kobo - ownerPart, until, purchase.meter_id,
  );
}

/** Bill due months for every monthly-billed GPRS meter (sweeper). */
export async function accrueAll(nowTs = Date.now()) {
  const rows = await db().all(
    `SELECT * FROM meters WHERE status = 'active' AND delivery_mode = 'ota' AND service_payer != 'tenant_per_purchase'
       AND (service_billed_until IS NULL OR service_billed_until <= ?) ORDER BY id LIMIT 100`,
    new Date(nowTs).toISOString(),
  );
  for (const m of rows) {
    try {
      await accrueServiceCharge(m, nowTs);
    } catch (err) {
      console.error('[service] accrual failed', m.meter_id, err.message);
    }
  }
}

/** Settings changes that reset billing: back on GPRS after a pause starts afresh. */
export function billedUntilAfterChange(meter, next) {
  const until = meter.service_billed_until;
  const resumesGprs = next.deliveryMode === 'ota' && meter.delivery_mode !== 'ota';
  if (resumesGprs && until && new Date(until).getTime() < Date.now()) return null;
  return until;
}

/** due is the tenant's unpaid charge; the owner's view adds ownerDue. */
export function serviceDto(meter, { forOwner = false } = {}) {
  const fee = feeFrom(tariffNow(), meter);
  return {
    gprs: isGprs(meter),
    payer: meter.service_payer,
    monthlyFee: koboToNaira(fee),
    due: koboToNaira(meter.service_due_kobo),
    ...(forOwner ? { ownerDue: koboToNaira(meter.service_owner_due_kobo) } : {}),
    billedUntil: meter.service_billed_until,
  };
}
