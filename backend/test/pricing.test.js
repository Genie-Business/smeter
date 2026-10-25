import assert from 'node:assert/strict';
import { test } from 'node:test';
import './helpers.js';

const { gatewayFee, grossUp, quote } = await import('../src/services/pricing.js');

const P = {
  feePercent: 1.5,
  feeFlatKobo: 10000,
  feeFlatThresholdKobo: 250000,
  feeCapKobo: 200000,
  minPurchaseKobo: 50000,
  maxPurchaseKobo: 50000000,
};

test('gateway fee: 1.5%, flat ₦100 from ₦2,500, capped at ₦2,000', () => {
  assert.equal(gatewayFee(100000, P), 1500); // ₦1,000 → ₦15
  assert.equal(gatewayFee(250000, P), 13750); // ₦2,500 → ₦37.50 + ₦100
  assert.equal(gatewayFee(50000000, P), 200000); // capped
});

test('grossUp charges enough that the net covers the amount', () => {
  for (const amount of [50000, 200000, 246000, 250000, 1000000, 20000000]) {
    const total = grossUp(amount, P);
    assert.ok(total - gatewayFee(total, P) >= amount, `net covers ${amount}`);
    assert.ok(total - 1 - gatewayFee(total - 1, P) < amount, `minimal for ${amount}`);
  }
});

test('quote: debt recovery, units and tenant-borne fee', () => {
  const q = quote({
    amountKobo: 200000, unitPriceKobo: 23000, baseCostKobo: 20950, feeBearer: 'tenant',
    debtKobo: 100000, debtPercent: 10,
  }, P);
  assert.equal(q.debtKobo, 20000);
  assert.equal(q.energyKobo, 180000);
  assert.equal(q.units, 7.82); // 1800 / 230, floored
  assert.equal(q.totalKobo - q.feeKobo, 200000);
  assert.equal(q.landlordNetKobo, q.debtKobo + q.markupKobo);
  assert.equal(q.platformShareKobo, q.baseKobo + q.feeKobo);
});

test('quote: debt recovery never exceeds what is owed', () => {
  const q = quote({ amountKobo: 500000, unitPriceKobo: 23000, baseCostKobo: 20950, feeBearer: 'tenant', debtKobo: 3000, debtPercent: 50 }, P);
  assert.equal(q.debtKobo, 3000);
});

test('quote: landlord-borne fee that would make payout negative is blocked', () => {
  assert.throws(
    () => quote({ amountKobo: 100000, unitPriceKobo: 20950, baseCostKobo: 20950, feeBearer: 'landlord' }, P),
    /cannot be processed/,
  );
});

test('quote: rejects missing price and out-of-range amounts', () => {
  assert.throws(() => quote({ amountKobo: 100000, unitPriceKobo: 0, baseCostKobo: 1, feeBearer: 'tenant' }, P), /unit price/);
  assert.throws(() => quote({ amountKobo: 100, unitPriceKobo: 23000, baseCostKobo: 1, feeBearer: 'tenant' }, P), /Minimum/);
});

// GPRS service charge
const BASE = { amountKobo: 500000, unitPriceKobo: 23000, baseCostKobo: 20950 };
const SVC = { tenantDueKobo: 0, ownerDueKobo: 0, monthlyFeeKobo: 150000, dailyKwh: 5, perPurchase: true };

test('service: the owner pays from their share, the rest stays due', () => {
  const plain = quote({ ...BASE, feeBearer: 'tenant' }, P);
  const q = quote({ ...BASE, feeBearer: 'tenant', service: { ...SVC, payer: 'owner', ownerDueKobo: 150000 } }, P);
  assert.equal(q.totalKobo, plain.totalKobo); // the tenant pays nothing extra
  assert.equal(q.serviceOwnerKobo, plain.landlordNetKobo); // ₦447.57 markup < ₦1,500 due: all of it
  assert.equal(q.landlordNetKobo, 0);
  assert.equal(q.platformShareKobo, plain.platformShareKobo + q.serviceOwnerKobo);
  assert.equal(q.serviceTenantKobo, 0);
});

test('service: the tenant monthly balance is added on top', () => {
  const plain = quote({ ...BASE, feeBearer: 'tenant' }, P);
  const q = quote({ ...BASE, feeBearer: 'tenant', service: { ...SVC, payer: 'tenant_monthly', tenantDueKobo: 150000 } }, P);
  assert.equal(q.units, plain.units);
  assert.equal(q.serviceTenantKobo, 150000);
  assert.equal(q.totalKobo - q.feeKobo, 500000 + 150000);
  assert.equal(q.landlordNetKobo, plain.landlordNetKobo); // owner unaffected
  assert.equal(q.platformShareKobo, q.baseKobo + q.feeKobo + 150000);
});

test('service: per purchase charges the days the units should last', () => {
  const q = quote({ ...BASE, feeBearer: 'tenant', service: { ...SVC, payer: 'tenant_per_purchase' } }, P);
  assert.equal(q.units, 21.73);
  assert.equal(q.serviceDays, 4.3); // 21.73 kWh / 5 kWh a day
  assert.equal(q.serviceTenantKobo, Math.round((150000 * 4.3) / 30)); // ₦215
  const manual = quote({ ...BASE, feeBearer: 'tenant', service: { ...SVC, payer: 'tenant_per_purchase', perPurchase: false } }, P);
  assert.equal(manual.serviceTenantKobo, 0);
});

test("service: each party's unpaid balance is collected from them after a switch", () => {
  const q = quote({
    ...BASE, feeBearer: 'tenant',
    service: { ...SVC, payer: 'tenant_monthly', tenantDueKobo: 50000, ownerDueKobo: 10000 },
  }, P);
  assert.equal(q.serviceTenantKobo, 50000);
  assert.equal(q.serviceOwnerKobo, 10000);
  assert.equal(q.serviceKobo, 60000);
});
