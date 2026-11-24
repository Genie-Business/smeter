// Owner tariffs on the head-end: one per owner for the main supply (source A),
// and a second for dual-source meters (source B, the account's S2 tariff).
import { db } from '../db.js';
import { geni } from '../geni/index.js';
import { koboToNaira } from '../util/http.js';
import { getGeniSettings, getTariffSettings } from './settings.js';

// A stored tariff_id always wins, so landlords created before prefixes existed keep theirs.
export const tariffIdFor = (landlord, prefix) => landlord.tariff_id ?? `${prefix}${String(landlord.id).padStart(6, '0')}`;

/** Make sure the landlord's tariff exists on the head-end with their price. */
export async function syncTariff(landlord) {
  const tariffId = tariffIdFor(landlord, (await getGeniSettings()).tariffPrefix);
  const { baseUnitCostNaira } = await getTariffSettings();
  const price = koboToNaira(landlord.unit_price_kobo || Math.round(baseUnitCostNaira * 100));
  await geni().upsertTariff({ tariffId, tariffName: `${landlord.full_name} (smeter)`.slice(0, 60), price, tax: 0 });
  if (!landlord.tariff_id) await db().run('UPDATE landlords SET tariff_id = ? WHERE id = ?', tariffId, landlord.id);
  return tariffId;
}

/**
 * Source B's price on the head-end: the owner's second tariff, used as the
 * account's second-rate (S2) tariff on dual-source meters. Falls back to the
 * source A price until the owner sets one.
 */
export async function syncTariffB(landlord) {
  const tariffId = landlord.tariff_id_b ?? `${tariffIdFor(landlord, (await getGeniSettings()).tariffPrefix)}B`;
  const { baseUnitCostNaira } = await getTariffSettings();
  const price = koboToNaira(landlord.unit_price_b_kobo || landlord.unit_price_kobo || Math.round(baseUnitCostNaira * 100));
  await geni().upsertTariff({ tariffId, tariffName: `${landlord.full_name} source B (smeter)`.slice(0, 60), price, tax: 0 });
  if (!landlord.tariff_id_b) await db().run('UPDATE landlords SET tariff_id_b = ? WHERE id = ?', tariffId, landlord.id);
  return tariffId;
}
