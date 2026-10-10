// Pure pricing maths for a purchase. All amounts in kobo.
//
//   amount  = value the buyer picked
//   debt    = landlord debt recovery (percent of amount, capped at outstanding)
//   energy  = amount - debt → vended as units at the landlord's price per kWh
//   base    = units × base utility cost  (platform pays the utility)
//   markup  = energy - base              (landlord's margin)
//   fee     = gateway fee, borne by tenant (added on top) or landlord (deducted)
//
// The landlord settles debt + markup (- fee when they bear it). The platform
// keeps base (+ fee when the tenant bears it, to pay the gateway).
import { config } from '../config.js';
import { badRequest, conflict } from '../util/errors.js';

export function gatewayFee(kobo, p = config.payments) {
  const pct = Math.round((kobo * p.feePercent) / 100);
  const flat = kobo >= p.feeFlatThresholdKobo ? p.feeFlatKobo : 0;
  return Math.min(p.feeCapKobo, pct + flat);
}

/** Smallest total whose fee-net covers `amount`. */
export function grossUp(amount, p = config.payments) {
  let total = amount;
  for (let i = 0; i < 8; i++) {
    const next = amount + gatewayFee(total, p);
    if (next === total) break;
    total = next;
  }
  while (total - gatewayFee(total, p) < amount) total += 1;
  return total;
}

export function quote({ amountKobo, unitPriceKobo, baseCostKobo, feeBearer, debtKobo = 0, debtPercent = 0 }, p = config.payments) {
  if (!unitPriceKobo || unitPriceKobo <= 0) throw conflict('Your landlord has not set a unit price yet');
  if (amountKobo < p.minPurchaseKobo) throw badRequest(`Minimum purchase is ₦${p.minPurchaseKobo / 100}`);
  if (amountKobo > p.maxPurchaseKobo) throw badRequest(`Maximum purchase is ₦${(p.maxPurchaseKobo / 100).toLocaleString('en-NG')}`);

  const debt = Math.max(0, Math.min(debtKobo, Math.floor((amountKobo * debtPercent) / 100)));
  const energy = amountKobo - debt;
  const units = Math.floor((energy / unitPriceKobo) * 100) / 100;
  const base = Math.round(units * baseCostKobo);
  const markup = energy - base;

  let total;
  let fee;
  let landlordNet;
  let platformShare;
  if (feeBearer === 'landlord') {
    total = amountKobo;
    fee = gatewayFee(total, p);
    landlordNet = debt + markup - fee;
    platformShare = base; // subaccount bears the gateway fee
  } else {
    total = grossUp(amountKobo, p);
    fee = total - amountKobo;
    landlordNet = debt + markup;
    platformShare = base + fee; // main account bears the gateway fee
  }
  if (landlordNet < 0) {
    throw conflict('This purchase cannot be processed at the current unit price. Please contact your landlord.');
  }
  return {
    amountKobo,
    debtKobo: debt,
    energyKobo: energy,
    units,
    baseKobo: base,
    markupKobo: markup,
    feeKobo: fee,
    feeBearer: feeBearer === 'landlord' ? 'landlord' : 'tenant',
    totalKobo: total,
    landlordNetKobo: landlordNet,
    platformShareKobo: platformShare,
  };
}
