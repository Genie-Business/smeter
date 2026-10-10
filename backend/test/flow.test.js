// End-to-end: landlord onboarding → tenant OTP login → purchase → mock checkout
// → STS token vended + delivered, plus the main unhappy paths.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startServer } from './helpers.js';

const { geni } = await import('../src/geni/index.js');
const { settlePayment } = await import('../src/services/vending.js');
const { sweepOnce } = await import('../src/services/sweeper.js');
const { db } = await import('../src/db.js');
const { resetRateLimits } = await import('../src/util/rateLimit.js');

let api;
let landlordToken;
let tenantToken;
const METER = '47001234567';
const OFFLINE_METER = '47001234569';

before(async () => {
  api = await startServer();
});
after(() => api.close());

async function payWithMock(authorizationUrl, outcome = 'success') {
  const path = new URL(authorizationUrl).pathname;
  const res = await api.call('POST', path, { form: { outcome }, redirect: 'manual' });
  assert.equal(res.status, 303);
  return api.call('GET', res.headers.get('location'));
}

async function tenantLogin(meterId) {
  const start = await api.call('POST', '/v1/auth/tenant/start', { body: { meterId } });
  assert.equal(start.status, 200, start.text);
  const verify = await api.call('POST', '/v1/auth/tenant/verify', { body: { meterId, code: start.body.devCode } });
  assert.equal(verify.status, 200, verify.text);
  return verify.body.token;
}

test('landlord registers and logs in with email or phone', async () => {
  const reg = await api.call('POST', '/v1/auth/landlord/register', {
    body: { fullName: 'Onileayo Gabriel', email: 'gabriel@example.com', phone: '08031234567', password: 'correct-horse' },
  });
  assert.equal(reg.status, 201, reg.text);
  assert.equal(reg.body.landlord.phone, '+2348031234567');

  const dup = await api.call('POST', '/v1/auth/landlord/register', {
    body: { fullName: 'X Y', email: 'GABRIEL@example.com', phone: '08030000000', password: 'correct-horse' },
  });
  assert.equal(dup.status, 409);

  const bad = await api.call('POST', '/v1/auth/landlord/login', { body: { identifier: 'gabriel@example.com', password: 'nope-nope' } });
  assert.equal(bad.status, 401);
  const byPhone = await api.call('POST', '/v1/auth/landlord/login', { body: { identifier: '+2348031234567', password: 'correct-horse' } });
  assert.equal(byPhone.status, 200);
  landlordToken = byPhone.body.token;
});

test('tariff respects the regulatory cap and base cost', async () => {
  const high = await api.call('PUT', '/v1/landlord/tariff', { token: landlordToken, body: { unitPrice: 999 } });
  assert.equal(high.status, 400);
  assert.match(high.body.error.message, /regulated maximum/);
  const low = await api.call('PUT', '/v1/landlord/tariff', { token: landlordToken, body: { unitPrice: 10 } });
  assert.equal(low.status, 400);
  const ok = await api.call('PUT', '/v1/landlord/tariff', { token: landlordToken, body: { unitPrice: 230 } });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.landlord.unitPrice, 230);
});

test('meter binding validates the hardware id and prevents double assignment', async () => {
  const unknown = await api.call('POST', '/v1/landlord/meters', {
    token: landlordToken,
    body: { meterId: '0001112223', address: '1a Bourdillon, Ikoyi', tenantPhone: '08020000000' },
  });
  assert.equal(unknown.status, 400);

  const add = await api.call('POST', '/v1/landlord/meters', {
    token: landlordToken,
    body: {
      meterId: METER, address: '1a Bourdillon, Ikoyi, Lagos', apartment: '1', tenantPhone: '08021112222',
      tenantFirstName: 'Daniell', debtAmount: 1000, debtRecoveryPercent: 10,
    },
  });
  assert.equal(add.status, 201, add.text);
  assert.equal(add.body.meter.status, 'invited');

  const again = await api.call('POST', '/v1/landlord/meters', {
    token: landlordToken,
    body: { meterId: METER, address: 'Elsewhere', tenantPhone: '08021112222' },
  });
  assert.equal(again.status, 409);

  const offline = await api.call('POST', '/v1/landlord/meters', {
    token: landlordToken,
    body: { meterId: OFFLINE_METER, address: '1a Bourdillon, Ikoyi, Lagos', apartment: '2', tenantPhone: '08021113333' },
  });
  assert.equal(offline.status, 201);
});

test('tenant logs in with meter number + OTP, which accepts the link', async () => {
  const unknown = await api.call('POST', '/v1/auth/tenant/start', { body: { meterId: '99999999' } });
  assert.equal(unknown.status, 404);

  const start = await api.call('POST', '/v1/auth/tenant/start', { body: { meterId: METER } });
  assert.equal(start.status, 200);
  assert.match(start.body.sentTo, /^\+234802\*{4}22$/);
  const wrong = await api.call('POST', '/v1/auth/tenant/verify', { body: { meterId: METER, code: '000000' === start.body.devCode ? '111111' : '000000' } });
  assert.equal(wrong.status, 400);
  const ok = await api.call('POST', '/v1/auth/tenant/verify', { body: { meterId: METER, code: start.body.devCode } });
  assert.equal(ok.status, 200);
  tenantToken = ok.body.token;
  assert.equal(ok.body.tenant.unitPrice, 230);

  const meters = await api.call('GET', '/v1/landlord/meters', { token: landlordToken });
  assert.equal(meters.body.meters.find((m) => m.meterId === METER).status, 'active');
});

test('tenant sees the price and fee breakdown, pays, and the token is vended OTA', async () => {
  const q = await api.call('POST', '/v1/tenant/quote', { token: tenantToken, body: { amount: 2000 } });
  assert.equal(q.status, 200, q.text);
  assert.equal(q.body.quote.debtRecovered, 200);
  assert.equal(q.body.quote.energyAmount, 1800);
  assert.ok(q.body.quote.total > 2000);

  const p = await api.call('POST', '/v1/tenant/purchases', { token: tenantToken, body: { amount: 2000 } });
  assert.equal(p.status, 201, p.text);
  const pending = await api.call('GET', `/v1/tenant/purchases/${p.body.reference}`, { token: tenantToken });
  assert.equal(pending.body.purchase.status, 'pending');

  const done = await payWithMock(p.body.authorizationUrl);
  assert.match(done.text, /Payment received/);

  const vended = await api.call('GET', `/v1/tenant/purchases/${p.body.reference}`, { token: tenantToken });
  const purchase = vended.body.purchase;
  assert.equal(purchase.status, 'vended');
  assert.equal(purchase.delivery, 'ota_queued');
  assert.match(purchase.token, /^\d{4}(-\d{4}){4}$/);
  assert.equal(purchase.units, 7.82);
  assert.ok(geni().tasks.some((t) => t.kind === 'token' && t.meterId === METER));

  // Debt balance reduced by the recovered amount.
  const me = await api.call('GET', '/v1/tenant/me', { token: tenantToken });
  assert.equal(me.body.tenant.debt, 800);

  // Duplicate confirmations (webhook + redirect + poll) never vend twice.
  const vendsBefore = geni().receipt;
  await settlePayment(p.body.reference, { source: 'webhook' });
  await settlePayment(p.body.reference, { source: 'webhook' });
  assert.equal(geni().receipt, vendsBefore);

  const dash = await api.call('GET', '/v1/tenant/dashboard', { token: tenantToken });
  assert.equal(dash.status, 200);
  assert.equal(dash.body.recent[0].reference, p.body.reference);
  assert.equal(typeof dash.body.points, 'number');
});

test('offline meter falls back to a manual token', async () => {
  const token = await tenantLogin(OFFLINE_METER);
  const p = await api.call('POST', '/v1/tenant/purchases', { token, body: { amount: 1000 } });
  await payWithMock(p.body.authorizationUrl);
  const r = await api.call('GET', `/v1/tenant/purchases/${p.body.reference}`, { token });
  assert.equal(r.body.purchase.status, 'vended');
  assert.equal(r.body.purchase.delivery, 'manual');
  const n = await api.call('GET', '/v1/tenant/notifications', { token });
  assert.equal(n.body.data[0].title, 'Your token is ready');
  assert.match(n.body.data[0].body, /offline/);
});

test('declined payment is marked failed and not vended', async () => {
  const p = await api.call('POST', '/v1/tenant/purchases', { token: tenantToken, body: { amount: 1000 } });
  const res = await payWithMock(p.body.authorizationUrl, 'failed');
  assert.match(res.text, /not completed/);
  const r = await api.call('GET', `/v1/tenant/purchases/${p.body.reference}`, { token: tenantToken });
  assert.equal(r.body.purchase.status, 'failed');
});

test('sweeper reconciles a payment whose webhook never arrived', async () => {
  const p = await api.call('POST', '/v1/tenant/purchases', { token: tenantToken, body: { amount: 1500 } });
  const { payments } = await import('../src/providers/payments.js');
  await payments().complete(p.body.reference, true); // paid at the gateway, no webhook
  await db().run(
    'UPDATE purchases SET created_at = ? WHERE reference = ?',
    new Date(Date.now() - 10 * 60 * 1000).toISOString(), p.body.reference,
  );
  await sweepOnce();
  const r = await api.call('GET', `/v1/tenant/purchases/${p.body.reference}`, { token: tenantToken });
  assert.equal(r.body.purchase.status, 'vended');
  const n = await api.call('GET', '/v1/landlord/notifications', { token: landlordToken });
  assert.ok(n.body.data.some((x) => x.title === 'Late payment reconciled'));
});

test('usage report has a point per day and comparisons', async () => {
  const r = await api.call('GET', '/v1/tenant/usage?period=month&date=2026-05-15', { token: tenantToken });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.points.length, 31);
  assert.equal(r.body.label, 'May, 2026');
  assert.ok(r.body.totalKwh > 0);
  assert.ok(r.body.previousTotalKwh > 0);
  for (const period of ['day', 'week', 'year']) {
    const x = await api.call('GET', `/v1/tenant/usage?period=${period}`, { token: tenantToken });
    assert.equal(x.status, 200, x.text);
  }
  const live = await api.call('GET', '/v1/tenant/live', { token: tenantToken });
  assert.equal(live.body.online, true);
  assert.ok(live.body.volts > 200);
});

test('payout account: name check + OTP before saving', async () => {
  const mismatch = await api.call('POST', '/v1/landlord/bank/request', {
    token: landlordToken, body: { bankCode: '044', bankName: 'Access Bank', accountNumber: '0000000000' },
  });
  assert.equal(mismatch.status, 400);
  assert.match(mismatch.body.error.message, /doesn't match/);

  const req = await api.call('POST', '/v1/landlord/bank/request', {
    token: landlordToken, body: { bankCode: '044', bankName: 'Access Bank', accountNumber: '0123456789' },
  });
  assert.equal(req.status, 200, req.text);
  const confirm = await api.call('POST', '/v1/landlord/bank/confirm', { token: landlordToken, body: { code: req.body.devCode } });
  assert.equal(confirm.status, 200, confirm.text);
  assert.equal(confirm.body.landlord.bank.verified, true);
  assert.equal(confirm.body.landlord.bank.settlementActive, true);
});

test('dashboard, ledger and kill-switch', async () => {
  const dash = await api.call('GET', '/v1/landlord/dashboard', { token: landlordToken });
  assert.equal(dash.status, 200);
  assert.ok(dash.body.earnings > 0);
  assert.equal(dash.body.meters.total, 2);

  const ledger = await api.call('GET', '/v1/landlord/ledger', { token: landlordToken });
  assert.equal(ledger.body.totals.purchases, 3);
  assert.equal(ledger.body.totals.debtRecovered, 200 + 150);

  const off = await api.call('POST', `/v1/landlord/meters/${METER}/disconnect`, { token: landlordToken });
  assert.equal(off.status, 200);
  assert.equal(off.body.meter.relayState, 'disconnected');
  const offQueued = await api.call('POST', `/v1/landlord/meters/${OFFLINE_METER}/disconnect`, { token: landlordToken });
  assert.equal(offQueued.body.queued, true);
  assert.equal(offQueued.body.meter.relayState, 'disconnect_pending');
});

test('support tickets are routed to the right department', async () => {
  const t = await api.call('POST', '/v1/support/tickets', {
    token: tenantToken, body: { category: 'payment', description: 'Paid but units did not load' },
  });
  assert.equal(t.status, 201, t.text);
  assert.equal(t.body.ticket.department, 'finance');
  assert.equal(t.body.ticket.meterId, METER);
  const missing = await api.call('POST', '/v1/support/tickets', {
    token: landlordToken, body: { category: 'hardware', description: 'Meter is beeping constantly' },
  });
  assert.equal(missing.status, 400);
});

test('password reset by phone OTP', async () => {
  resetRateLimits(); // every test shares one client IP
  const unknown = await api.call('POST', '/v1/auth/password/forgot', { body: { phone: '08099999999' } });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error.message, 'Number not found');
  const forgot = await api.call('POST', '/v1/auth/password/forgot', { body: { phone: '08031234567' } });
  const verify = await api.call('POST', '/v1/auth/password/verify', { body: { phone: '08031234567', code: forgot.body.devCode } });
  assert.equal(verify.status, 200);
  const reset = await api.call('POST', '/v1/auth/password/reset', { body: { resetToken: verify.body.resetToken, newPassword: 'brand-new-pass' } });
  assert.equal(reset.status, 200);
  const login = await api.call('POST', '/v1/auth/landlord/login', { body: { identifier: 'gabriel@example.com', password: 'brand-new-pass' } });
  assert.equal(login.status, 200);
});

test('webhook with a bad signature is rejected', async () => {
  const r = await api.call('POST', '/v1/webhooks/paystack', { body: { event: 'charge.success', data: { reference: 'x' } } });
  assert.equal(r.status, 401);
});

test('roles are enforced', async () => {
  const a = await api.call('GET', '/v1/landlord/dashboard', { token: tenantToken });
  assert.equal(a.status, 403);
  const b = await api.call('GET', '/v1/tenant/me', { token: landlordToken });
  assert.equal(b.status, 403);
  const c = await api.call('GET', '/v1/tenant/me');
  assert.equal(c.status, 401);
});

test('manual-token mode: no OTA push, usage from purchases, no remote switching', async () => {
  resetRateLimits();
  const MANUAL = '47005550001';
  const add = await api.call('POST', '/v1/landlord/meters', {
    token: landlordToken,
    body: { meterId: MANUAL, address: '2 Bourdillon, Ikoyi', apartment: '3', tenantPhone: '08024445555', deliveryMode: 'manual' },
  });
  assert.equal(add.status, 201, add.text);
  assert.equal(add.body.meter.deliveryMode, 'manual');

  const token = await tenantLogin(MANUAL);
  const tasksBefore = geni().tasks.length;
  const p = await api.call('POST', '/v1/tenant/purchases', { token, body: { amount: 3000 } });
  await payWithMock(p.body.authorizationUrl);
  const r = await api.call('GET', `/v1/tenant/purchases/${p.body.reference}`, { token });
  assert.equal(r.body.purchase.status, 'vended');
  assert.equal(r.body.purchase.delivery, 'manual');
  assert.equal(geni().tasks.length, tasksBefore, 'nothing pushed over the air');

  const live = await api.call('GET', '/v1/tenant/live', { token });
  assert.equal(live.body.mode, 'manual');

  const usage = await api.call('GET', '/v1/tenant/usage?period=month', { token });
  assert.equal(usage.body.source, 'purchases');
  assert.equal(usage.body.purchasesCount, 1);
  assert.ok(usage.body.totalKwh > 0);

  const dash = await api.call('GET', '/v1/tenant/dashboard', { token });
  assert.equal(dash.body.points, null);
  assert.equal(dash.body.lastToken.reference, p.body.reference);
  assert.equal(dash.body.month.purchases, 1);

  const off = await api.call('POST', `/v1/landlord/meters/${MANUAL}/disconnect`, { token: landlordToken });
  assert.equal(off.status, 409);

  // Only the property owner can switch modes: a tenant's attempt is ignored.
  const tenantTry = await api.call('PATCH', '/v1/tenant/me', { token, body: { deliveryMode: 'ota' } });
  assert.equal(tenantTry.body.tenant.deliveryMode, 'manual');

  const sw = await api.call('PATCH', `/v1/landlord/meters/${MANUAL}`, { token: landlordToken, body: { deliveryMode: 'ota' } });
  assert.equal(sw.body.meter.deliveryMode, 'ota');
  const bad = await api.call('PATCH', `/v1/landlord/meters/${MANUAL}`, { token: landlordToken, body: { deliveryMode: 'bluetooth' } });
  assert.equal(bad.status, 400);
  const n = await api.call('GET', '/v1/tenant/notifications', { token });
  assert.equal(n.body.data[0].title, 'Tokens now load automatically');
});
