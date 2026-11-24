// Dual-source meters: one meter + our accessory metering two power sources.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startServer } from './helpers.js';

const { geni } = await import('../src/geni/index.js');
const { db } = await import('../src/db.js');
const { payments } = await import('../src/providers/payments.js');
const { resetRateLimits } = await import('../src/util/rateLimit.js');
const { energyColumns } = await import('../src/geni/parse.js');
const { config } = await import('../src/config.js');

let api;
let token;
const SINGLE = '47002000001';
const DUAL = '47002000002';

before(async () => {
  api = await startServer();
  const reg = await api.call('POST', '/v1/auth/landlord/register', {
    body: { fullName: 'Dual Owner', email: 'dual@example.com', phone: '08035550001', password: 'correct-horse' },
  });
  token = reg.body.token;
  await db().run(
    `UPDATE landlords SET address = '1 Main St', unit_price_kobo = 20000, bank_verified_at = ?, settlement_ref = 'ACCT_mock' WHERE email = 'dual@example.com'`,
    new Date().toISOString(),
  );
});
after(() => api.close());

const addMeter = (meterId, extra = {}) => api.call('POST', '/v1/landlord/meters', {
  token,
  body: { meterId, address: '1 Main St, Yaba', tenantPhone: `0803${meterId.slice(-7)}`, tenantEmail: `${meterId}@example.com`, ...extra },
});

async function tenantToken(meterId) {
  resetRateLimits();
  const start = await api.call('POST', '/v1/auth/tenant/start', { body: { meterId } });
  const verify = await api.call('POST', '/v1/auth/tenant/verify', { body: { meterId, code: start.body.devCode } });
  assert.equal(verify.status, 200, verify.text);
  return verify.body.token;
}

test('column detection separates the two registers', () => {
  const v = { 'Total Active Energy(kWh)': 100, 'Tariff 2 Active Energy(kWh)': 40, 'Voltage(V)': 230 };
  assert.deepEqual(energyColumns(v, config.geni.sourceBColumn), { a: 'Total Active Energy(kWh)', b: 'Tariff 2 Active Energy(kWh)' });
  assert.equal(energyColumns({ 'Total Active Energy(kWh)': 1 }, config.geni.sourceBColumn).b, undefined);
});

test('a single-source meter is unchanged', async () => {
  const add = await addMeter(SINGLE);
  assert.equal(add.status, 201, add.text);
  assert.equal(add.body.meter.dualSource, false);
  assert.deepEqual(add.body.meter.sources.map((s) => s.key), ['a']);
});

test('owner adds a dual-source meter; source B gets its own tariff on the head-end', async () => {
  geni().dualSource.add(DUAL);
  const put = await api.call('PUT', '/v1/landlord/tariff', { token, body: { unitPriceB: 150 } });
  assert.equal(put.status, 200, put.text);
  assert.equal(put.body.landlord.unitPriceB, 150);
  const add = await addMeter(DUAL, { dualSource: true, sourceALabel: 'Grid', sourceBLabel: 'Solar', sourceBPrepaid: true });
  assert.equal(add.status, 201, add.text);
  assert.equal(add.body.meter.dualSource, true);
  assert.deepEqual(add.body.meter.sources, [
    { key: 'a', label: 'Grid', prepaid: true },
    { key: 'b', label: 'Solar', prepaid: true },
  ]);
  const owner = await db().get("SELECT tariff_id, tariff_id_b FROM landlords WHERE email = 'dual@example.com'");
  assert.match(owner.tariff_id_b, /^SML\d{6}B$/);
  assert.equal(geni().tariffs.get(owner.tariff_id_b).price, 150);
  const account = geni().accounts.get(DUAL);
  assert.equal(account.tariffId, owner.tariff_id);
  assert.equal(account.tariffIdB, owner.tariff_id_b);
});

test('prepaid source B needs a dual-source meter and a price', async () => {
  const noDual = await api.call('PATCH', `/v1/landlord/meters/${SINGLE}`, { token, body: { sourceBPrepaid: true } });
  assert.equal(noDual.status, 400);
  await db().run("UPDATE landlords SET unit_price_b_kobo = 0 WHERE email = 'dual@example.com'");
  const noPrice = await api.call('PATCH', `/v1/landlord/meters/${SINGLE}`, { token, body: { dualSource: true, sourceBPrepaid: true } });
  assert.equal(noPrice.status, 400);
  await db().run("UPDATE landlords SET unit_price_b_kobo = 15000 WHERE email = 'dual@example.com'");
});

test('the usage report splits the two sources and costs each at its own price', async () => {
  // Readings before the tenancy began belong to someone else, so start it earlier.
  await db().run('UPDATE meters SET tenancy_started_at = ? WHERE meter_id = ?', new Date(Date.now() - 20 * 864e5).toISOString(), DUAL);
  const t = await tenantToken(DUAL);
  const r = await api.call('GET', '/v1/tenant/usage?period=week', { token: t });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.dualSource, true);
  const [a, b] = r.body.sources;
  assert.equal(a.label, 'Grid');
  assert.equal(b.label, 'Solar');
  assert.equal(a.unitPrice, 200);
  assert.equal(b.unitPrice, 150);
  assert.ok(a.totalKwh > 0 && b.totalKwh > 0, 'both sources have consumption');
  assert.ok(Math.abs(r.body.totalKwh - (a.totalKwh + b.totalKwh)) < 0.05, 'top-level total is the sum');
  assert.equal(r.body.points.length, a.points.length);
  assert.ok(Math.abs(a.totalCost - a.totalKwh * 200) < 0.05);
  assert.ok(Math.abs(b.totalCost - b.totalKwh * 150) < 0.05);

  const single = await tenantToken(SINGLE);
  const s = await api.call('GET', '/v1/tenant/usage?period=week', { token: single });
  assert.equal(s.body.sources, undefined);
});

test('source B tokens are minted on the second tariff and priced at the B price', async () => {
  const t = await tenantToken(DUAL);
  const quote = await api.call('POST', '/v1/tenant/quote', { token: t, body: { amount: 1500, source: 'b' } });
  assert.equal(quote.status, 200, quote.text);
  assert.equal(quote.body.unitPrice, 150);
  assert.equal(quote.body.quote.units, 10);
  const q = await api.call('POST', '/v1/tenant/quote', { token: t, body: { amount: 2000, source: 'a' } });
  assert.equal(q.body.quote.units, 10);

  const buy = await api.call('POST', '/v1/tenant/purchases', { token: t, body: { amount: 1500, source: 'b' } });
  assert.equal(buy.status, 201, buy.text);
  await payments().complete(buy.body.reference, true);
  const p = await api.call('GET', `/v1/tenant/purchases/${buy.body.reference}`, { token: t });
  assert.equal(p.body.purchase.status, 'vended');
  assert.equal(p.body.purchase.source, 'b');
  assert.equal(p.body.purchase.unitPrice, 150);
  assert.equal(geni().vends.at(-1).source, 'b');
  assert.equal(geni().vends.at(-1).meterId, DUAL);
});

test('source B can only be bought when prepaid is on', async () => {
  const t = await tenantToken(SINGLE);
  const nope = await api.call('POST', '/v1/tenant/quote', { token: t, body: { amount: 1500, source: 'b' } });
  assert.equal(nope.status, 400);
  const off = await api.call('PATCH', `/v1/landlord/meters/${DUAL}`, { token, body: { sourceBPrepaid: false } });
  assert.equal(off.status, 200, off.text);
  const dt = await tenantToken(DUAL);
  const blocked = await api.call('POST', '/v1/tenant/purchases', { token: dt, body: { amount: 1500, source: 'b' } });
  assert.equal(blocked.status, 400);
  const still = await api.call('GET', '/v1/tenant/usage?period=week', { token: dt });
  assert.equal(still.body.sources[1].prepaid, false, 'usage is still metered when not prepaid');
});

test('turning dual-source off falls back to one source and the single tariff', async () => {
  const off = await api.call('PATCH', `/v1/landlord/meters/${DUAL}`, { token, body: { dualSource: false } });
  assert.equal(off.status, 200, off.text);
  assert.equal(off.body.meter.dualSource, false);
  const account = geni().accounts.get(DUAL);
  assert.equal(account.tariffIdB, undefined);
  const t = await tenantToken(DUAL);
  const r = await api.call('GET', '/v1/tenant/usage?period=week', { token: t });
  assert.equal(r.body.sources, undefined);
});

test('admins (account owners) can switch a meter’s second source; editors cannot', async () => {
  const { hashPassword } = await import('../src/auth/password.js');
  for (const [email, role] of [['owner-admin@example.com', 'owner'], ['editor-admin@example.com', 'editor']]) {
    await db().run('INSERT INTO staff (email, name, role, password_hash) VALUES (?, ?, ?, ?)', email, role, role, await hashPassword('admin-pass-123'));
  }
  const login = async (email) => (await api.call('POST', '/v1/staff/login', { body: { email, password: 'admin-pass-123' } })).body.token;
  const adminToken = await login('owner-admin@example.com');
  const editorToken = await login('editor-admin@example.com');
  assert.ok(adminToken && editorToken);

  const meterId = '47002000003';
  const add = await addMeter(meterId);
  assert.equal(add.status, 201, add.text);

  const denied = await api.call('PATCH', `/v1/staff/meters/${meterId}`, { token: editorToken, body: { dualSource: true } });
  assert.equal(denied.status, 403);

  const on = await api.call('PATCH', `/v1/staff/meters/${meterId}`, { token: adminToken, body: { dualSource: true, sourceBLabel: 'Solar' } });
  assert.equal(on.status, 200, on.text);
  assert.equal(on.body.meter.dualSource, true);
  assert.equal(on.body.meter.sources[1].label, 'Solar');
  assert.ok(geni().accounts.get(meterId).tariffIdB, 'account points at the second tariff');
  const note = await db().get("SELECT title FROM notifications WHERE recipient_type = 'landlord' AND title = 'Meter power sources updated'");
  assert.ok(note, 'owner was told');

  const noPrice = await api.call('PATCH', `/v1/staff/meters/${meterId}`, { token: adminToken, body: { sourceBPrepaid: true } });
  assert.equal(noPrice.status, 200, 'owner has a second price set by earlier tests');
  await db().run("UPDATE landlords SET unit_price_b_kobo = 0 WHERE email = 'dual@example.com'");
  const blocked = await api.call('PATCH', `/v1/staff/meters/${meterId}`, { token: adminToken, body: { sourceBPrepaid: true } });
  assert.equal(blocked.status, 400);

  const off = await api.call('PATCH', `/v1/staff/meters/${meterId}`, { token: adminToken, body: { dualSource: false } });
  assert.equal(off.body.meter.dualSource, false);
  assert.equal(geni().accounts.get(meterId).tariffIdB, undefined);
});
