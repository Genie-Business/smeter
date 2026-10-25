// Pure pricing maths for a purchase. All amounts in kobo.
//
//   amount  = value the buyer picked
//   debt    = landlord debt recovery (percent of amount, capped at outstanding)
//   energy  = amount - debt → vended as units at the landlord's price per kWh
//   base    = units × base utility cost  (platform pays the utility)
//   markup  = energy - base              (landlord's margin)
//   fee     = gateway fee, borne by tenant (added on top) or landlord (deducted)
//
//   service = GPRS service charge (see services/service-charge.js): added on
//             top for the tenant, or taken from the owner's share
//
// The landlord settles debt + markup (- fee when they bear it, - their service
// charge). The platform keeps base + service (+ fee when the tenant bears it).
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

/**
 * Service charge on a purchase of `units`.
 * service: { payer, tenantDueKobo, ownerDueKobo, monthlyFeeKobo, dailyKwh, perPurchase }:
 * each party's unpaid balance is collected from them whatever the current payer;
 * perPurchase is false when no ahead-billing applies (a manual meter).
 */
export function serviceCharge(units, service) {
  if (!service) return { tenantKobo: 0, ownerDueKobo: 0, days: 0 };
  let tenantKobo = service.tenantDueKobo ?? 0;
  let days = 0;
  if (service.payer === 'tenant_per_purchase' && service.perPurchase && service.dailyKwh > 0 && units > 0) {
    days = Math.min(365, Math.round((units / service.dailyKwh) * 10) / 10);
    tenantKobo += Math.round((service.monthlyFeeKobo * days) / 30);
  }
  return { tenantKobo, ownerDueKobo: service.ownerDueKobo ?? 0, days };
}

export function quote({ amountKobo, unitPriceKobo, baseCostKobo, feeBearer, debtKobo = 0, debtPercent = 0, service }, p = config.payments) {
  if (!unitPriceKobo || unitPriceKobo <= 0) throw conflict('Your landlord has not set a unit price yet');
  if (amountKobo < p.minPurchaseKobo) throw badRequest(`Minimum purchase is ₦${p.minPurchaseKobo / 100}`);
  if (amountKobo > p.maxPurchaseKobo) throw badRequest(`Maximum purchase is ₦${(p.maxPurchaseKobo / 100).toLocaleString('en-NG')}`);

  const debt = Math.max(0, Math.min(debtKobo, Math.floor((amountKobo * debtPercent) / 100)));
  const energy = amountKobo - debt;
  const units = Math.floor((energy / unitPriceKobo) * 100) / 100;
  const base = Math.round(units * baseCostKobo);
  const markup = energy - base;
  const svc = serviceCharge(units, service);
  const charged = amountKobo + svc.tenantKobo; // service is paid on top of the amount

  let total;
  let fee;
  let landlordNet;
  let platformShare;
  if (feeBearer === 'landlord') {
    total = charged;
    fee = gatewayFee(total, p);
    landlordNet = debt + markup - fee;
    platformShare = base + svc.tenantKobo; // subaccount bears the gateway fee
  } else {
    total = grossUp(charged, p);
    fee = total - charged;
    landlordNet = debt + markup;
    platformShare = base + svc.tenantKobo + fee; // main account bears the gateway fee
  }
  if (landlordNet < 0) {
    throw conflict('This purchase cannot be processed at the current unit price. Please contact your landlord.');
  }
  // An owner-paid service charge comes out of what's left of their share; any
  // remainder stays due for the next purchase.
  const ownerService = Math.min(svc.ownerDueKobo, landlordNet);
  landlordNet -= ownerService;
  platformShare += ownerService;
  return {
    amountKobo,
    debtKobo: debt,
    energyKobo: energy,
    units,
    baseKobo: base,
    markupKobo: markup,
    feeKobo: fee,
    feeBearer: feeBearer === 'landlord' ? 'landlord' : 'tenant',
    serviceKobo: svc.tenantKobo + ownerService,
    serviceTenantKobo: svc.tenantKobo,
    serviceOwnerKobo: ownerService,
    serviceDays: svc.days,
    servicePayer: service?.payer ?? null,
    totalKobo: total,
    landlordNetKobo: landlordNet,
    platformShareKobo: platformShare,
  };
}
