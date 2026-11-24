// Turning a meter's second power source (our accessory) on or off, and how it is
// sold. Shared by the owner's app and the admin dashboard.
import { z } from 'zod';
import { db } from '../db.js';
import { asUpstream } from '../geni/client.js';
import { geni } from '../geni/index.js';
import { badRequest } from '../util/errors.js';
import { syncTariff, syncTariffB } from './head-end-tariffs.js';

const sourceLabel = z.string().trim().min(1).max(24);

/** Request fields for the dual-source setup (merge into a meter body schema). */
export const dualSourceFields = {
  dualSource: z.boolean().optional(),
  sourceALabel: sourceLabel.optional(),
  sourceBLabel: sourceLabel.optional(),
  sourceBPrepaid: z.boolean().optional(),
};

/** A source B that is sold prepaid needs a dual-source meter and a price for it. */
export function checkPrepaidB(landlord, dual, prepaid) {
  if (!prepaid) return;
  if (!dual) throw badRequest('Turn on the second power source before selling it prepaid');
  if (!(landlord.unit_price_b_kobo > 0)) throw badRequest('Set a price per kWh for the second source first', { sourceBPrepaid: 'Set the second source price first' });
}

/**
 * Apply dual-source changes from `body` to an existing meter: validate, re-point
 * the head-end account's second-rate tariff when the flag flips, then save.
 * Returns the updated meter row and whether anything changed.
 */
export async function applyDualSource({ meter, landlord, body }) {
  const dual = body.dualSource ?? Boolean(meter.dual_source);
  const prepaidB = dual && (body.sourceBPrepaid ?? Boolean(meter.source_b_prepaid));
  checkPrepaidB(landlord, dual, body.sourceBPrepaid ?? (body.dualSource ? false : undefined));
  if (dual !== Boolean(meter.dual_source)) {
    // Point the account's second-rate tariff at source B's (or back at source A's).
    try {
      const client = geni();
      const account = await client.getAccount(meter.meter_id);
      if (account) {
        const tariffId = await syncTariff(landlord);
        const tariffIdB = dual ? await syncTariffB(landlord) : undefined;
        await client.bindAccount({ customerId: meter.customer_id, meterId: meter.meter_id, region: meter.address.slice(0, 60), tariffId, tariffIdB }, account);
      }
    } catch (err) {
      throw asUpstream(err);
    }
  }
  await db().run(
    `UPDATE meters SET dual_source = ?, source_a_label = COALESCE(?, source_a_label),
       source_b_label = COALESCE(?, source_b_label), source_b_prepaid = ? WHERE id = ?`,
    dual, body.sourceALabel ?? null, body.sourceBLabel ?? null, prepaidB, meter.id,
  );
  return db().get('SELECT * FROM meters WHERE id = ?', meter.id);
}
