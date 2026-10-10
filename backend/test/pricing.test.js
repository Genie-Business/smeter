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
