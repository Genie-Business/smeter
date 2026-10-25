// GPRS service charge: owner-paid, tenant monthly (on its own or added to the
// next purchase) and per purchase, plus switching between them.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startServer } from './helpers.js';

const { db } = await import('../src/db.js');
const { saveTariffSettings } = await import('../src/services/settings.js');
const { sweepOnce } = await import('../src/services/sweeper.js');

const METER = '47005550001';
let api;
let owner;
let tenant;

before(async () => {
  api = await startServer();
  await saveTariffSettings({ gprsFeeSinglePhaseNaira: 1500, gprsFeeThreePhaseNaira: 2500 }, null);
});
after(() => api.close());

async function pay(authorizationUrl) {
  const path = new URL(authorizationUrl).pathname;
  const res = await api.call('POST', path, { form: { outcome: 'success' }, redirect: 'manual' });
  assert.equal(res.status, 303);
  await api.call('GET', res.headers.get('location'));
}
const meterRow = () => db().get('SELECT * FROM meters WHERE meter_id = ?', METER);
const monthPassed = () => db().run(
  'UPDATE meters SET service_billed_until = ? WHERE meter_id = ?', new Date(Date.now() - 1000).toISOString(), METER,
);
async function buy(amount) {
  const p = await api.call('POST', '/v1/tenant/purchases', { token: tenant, body: { amount } });
  assert.equal(p.status, 201, p.text);
  await pay(p.body.authorizationUrl);
  const r = await api.call('GET', `/v1/tenant/purchases/${p.body.reference}`, { token: tenant });
  assert.equal(r.body.purchase.status, 'vended');
  return { quote: p.body.quote, purchase: r.body.purchase };
}

test('setup: owner, GPRS meter (owner pays by default), tenant', async () => {
  const reg = await api.call('POST', '/v1/auth/landlord/register', {
    body: { fullName: 'Service Owner', email: 'svc@example.com', phone: '08035550001', password: 'correct-horse' },
  });
  owner = reg.body.token;
  assert.equal((await api.call('PUT', '/v1/landlord/tariff', { token: owner, body: { unitPrice: 230 } })).status, 200);
  const add = await api.call('POST', '/v1/landlord/meters', {
    token: owner,
    body: { meterId: METER, address: '3 Service Road, Lekki', tenantPhone: '08025550001', tenantEmail: 'svc-tenant@example.com' },
  });
  assert.equal(add.status, 201, add.text);
  assert.deepEqual(
    { payer: add.body.meter.service.payer, fee: add.body.meter.service.monthlyFee, gprs: add.body.meter.service.gprs },
    { payer: 'owner', fee: 1500, gprs: true },
  );
  const start = await api.call('POST', '/v1/auth/tenant/start', { body: { meterId: METER } });
  const verify = await api.call('POST', '/v1/auth/tenant/verify', { body: { meterId: METER, code: start.body.devCode } });
  tenant = verify.body.token;
});

test('owner pays: billed monthly, taken from their share, the rest carried over', async () => {
  const dash = await api.call('GET', '/v1/tenant/dashboard', { token: tenant });
  assert.equal(dash.body.tenant.service.due, 0); // nothing for the tenant
  assert.equal(dash.body.tenant.service.ownerDue, undefined); // the owner's balance isn't shown to tenants
  assert.equal((await meterRow()).service_owner_due_kobo, 150000);
  const n = await api.call('GET', '/v1/landlord/notifications', { token: owner });
  assert.ok(n.body.data.some((x) => x.title === 'Meter service charge'));

  const { quote, purchase } = await buy(5000);
  assert.equal(quote.serviceCharge, 0);
  const tx = (await api.call('GET', '/v1/landlord/transactions', { token: owner })).body.data[0];
  assert.equal(tx.reference, purchase.reference);
  assert.equal(tx.ownerServiceCharge, 447.56); // the whole ₦447.56 markup
  assert.equal(tx.landlordNet, 0);
  const m = await api.call('GET', `/v1/landlord/meters/${METER}`, { token: owner });
  assert.equal(m.body.meter.service.ownerDue, 1052.44);
});

test('tenant monthly: due when the month starts, payable on its own', async () => {
  const patch = await api.call('PATCH', `/v1/landlord/meters/${METER}`, { token: owner, body: { servicePayer: 'tenant_monthly' } });
  assert.equal(patch.body.meter.service.payer, 'tenant_monthly');
  assert.equal(patch.body.meter.service.ownerDue, 1052.44); // stays the owner's
  // This month is already billed (to the owner), so nothing is due yet.
  assert.equal((await api.call('GET', '/v1/tenant/dashboard', { token: tenant })).body.tenant.service.due, 0);

  await monthPassed();
  const dash = await api.call('GET', '/v1/tenant/dashboard', { token: tenant });
  assert.equal(dash.body.tenant.service.due, 1500);
  const n = await api.call('GET', '/v1/tenant/notifications', { token: tenant });
  assert.ok(n.body.data.some((x) => x.title === 'Service charge due'));

  const sc = await api.call('POST', '/v1/tenant/service-charge', { token: tenant, body: {} });
  assert.equal(sc.status, 201, sc.text);
  assert.equal(sc.body.amount, 1500);
  assert.ok(sc.body.total > 1500); // gateway fee on top
  await pay(sc.body.authorizationUrl);
  const r = await api.call('GET', `/v1/tenant/purchases/${sc.body.reference}`, { token: tenant });
  assert.equal(r.body.purchase.status, 'vended');
  assert.equal(r.body.purchase.kind, 'service');
  assert.equal(r.body.purchase.token, null);
  assert.equal((await api.call('GET', '/v1/tenant/dashboard', { token: tenant })).body.tenant.service.due, 0);

  const again = await api.call('POST', '/v1/tenant/service-charge', { token: tenant, body: {} });
  assert.equal(again.status, 409);
});

test('tenant monthly: an unpaid month is added to the next purchase', async () => {
  await monthPassed();
  const { quote } = await buy(5000);
  assert.equal(quote.serviceCharge, 1500);
  assert.equal(quote.total - quote.fee, 6500);
  const m = await meterRow();
  assert.equal(m.service_due_kobo, 0);
  assert.equal(m.service_owner_due_kobo, 105244 - 44756); // the owner's carry-over keeps coming off their share
});

test('per purchase: charged for the days the units should last', async () => {
  await api.call('PATCH', `/v1/landlord/meters/${METER}`, { token: owner, body: { servicePayer: 'tenant_per_purchase' } });
  const before = new Date((await meterRow()).service_billed_until).getTime();
  const { quote, purchase } = await buy(5000);
  assert.ok(quote.serviceDays > 0);
  assert.equal(quote.serviceCharge, Math.round((1500 * quote.serviceDays) / 30 * 100) / 100);
  assert.equal(purchase.serviceDays, quote.serviceDays);
  const after = new Date((await meterRow()).service_billed_until).getTime();
  assert.ok(Math.abs(after - before - quote.serviceDays * 86400000) < 5000, 'billed ahead by those days');
  // No monthly billing on this option.
  await monthPassed();
  await sweepOnce();
  assert.equal((await meterRow()).service_due_kobo, 0);
});

test('manual meters have no service charge; going back to GPRS starts afresh', async () => {
  await api.call('PATCH', `/v1/landlord/meters/${METER}`, { token: owner, body: { deliveryMode: 'manual', servicePayer: 'owner' } });
  const { quote } = await buy(1000);
  assert.equal(quote.serviceCharge, 0);
  const ownerDue = (await meterRow()).service_owner_due_kobo; // after that purchase took its share
  await sweepOnce();
  assert.equal((await meterRow()).service_owner_due_kobo, ownerDue); // no billing while manual

  await api.call('PATCH', `/v1/landlord/meters/${METER}`, { token: owner, body: { deliveryMode: 'ota' } });
  assert.equal((await meterRow()).service_billed_until, null); // the paused months aren't billed
  await sweepOnce();
  await sweepOnce(); // a second sweep bills nothing more
  assert.equal((await meterRow()).service_owner_due_kobo, ownerDue + 150000);
});
