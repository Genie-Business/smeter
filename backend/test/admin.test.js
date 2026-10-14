// Admin dashboard API, content management and website endpoints.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startServer } from './helpers.js';

const { db } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth/password.js');
const { resetRateLimits } = await import('../src/util/rateLimit.js');

let api;
let staffToken;
let editorToken;

before(async () => {
  api = await startServer();
  await db().run(
    "INSERT INTO staff (email, name, password_hash, role) VALUES (?, ?, ?, 'owner')",
    'ops@smeter.test', 'Ops Owner', await hashPassword('owner-password-1'),
  );
});
after(() => api.close());

async function seedOperationalData() {
  const reg = await api.call('POST', '/v1/auth/landlord/register', {
    body: { fullName: 'Ada Lovelace', email: 'ada@example.com', phone: '08035550000', password: 'correct-horse' },
  });
  const t = reg.body.token;
  await api.call('PUT', '/v1/landlord/tariff', { token: t, body: { unitPrice: 230 } });
  await api.call('POST', '/v1/landlord/meters', {
    token: t,
    body: { meterId: '47009990001', address: '3 Allen Ave, Ikeja', apartment: '4', tenantPhone: '08036660000', tenantEmail: 'tenant4@example.com', deliveryMode: 'manual' },
  });
}

test('staff login and role checks', async () => {
  const bad = await api.call('POST', '/v1/staff/login', { body: { email: 'ops@smeter.test', password: 'nope' } });
  assert.equal(bad.status, 401);
  const ok = await api.call('POST', '/v1/staff/login', { body: { email: 'OPS@smeter.test', password: 'owner-password-1' } });
  assert.equal(ok.status, 200, ok.text);
  staffToken = ok.body.token;
  assert.equal(ok.body.staff.role, 'owner');

  const unauth = await api.call('GET', '/v1/staff/overview');
  assert.equal(unauth.status, 401);

  const add = await api.call('POST', '/v1/staff/users', {
    token: staffToken,
    body: { email: 'editor@smeter.test', name: 'Ed', password: 'editor-password-1', role: 'editor' },
  });
  assert.equal(add.status, 201, add.text);
  editorToken = (await api.call('POST', '/v1/staff/login', { body: { email: 'editor@smeter.test', password: 'editor-password-1' } })).body.token;
  const editorAdd = await api.call('POST', '/v1/staff/users', {
    token: editorToken,
    body: { email: 'x@smeter.test', name: 'X', password: 'whatever-password', role: 'owner' },
  });
  assert.equal(editorAdd.status, 403);
});

test('landlord and tenant tokens cannot use the staff API', async () => {
  resetRateLimits();
  await seedOperationalData();
  const login = await api.call('POST', '/v1/auth/landlord/login', { body: { identifier: 'ada@example.com', password: 'correct-horse' } });
  const r = await api.call('GET', '/v1/staff/overview', { token: login.body.token });
  assert.equal(r.status, 403);
  // and staff tokens can't file support tickets
  const s = await api.call('POST', '/v1/support/tickets', { token: staffToken, body: { category: 'other', description: 'testing staff' } });
  assert.equal(s.status, 401);
});

test('overview, owners and meters', async () => {
  const o = await api.call('GET', '/v1/staff/overview', { token: editorToken });
  assert.equal(o.status, 200, o.text);
  assert.equal(o.body.landlords, 1);
  assert.equal(o.body.meters.manual, 1);

  const list = await api.call('GET', '/v1/staff/landlords?search=ada', { token: editorToken });
  assert.equal(list.body.total, 1);
  assert.equal(list.body.data[0].meterCount, 1);
  const detail = await api.call('GET', `/v1/staff/landlords/${list.body.data[0].id}`, { token: editorToken });
  assert.equal(detail.body.meters[0].meterId, '47009990001');

  const meters = await api.call('GET', '/v1/staff/meters?mode=manual', { token: editorToken });
  assert.equal(meters.body.total, 1);
  assert.equal(meters.body.data[0].landlordName, 'Ada Lovelace');
  const meter = await api.call('GET', '/v1/staff/meters/47009990001', { token: editorToken });
  assert.equal(meter.body.live.mode, 'manual');
  const missing = await api.call('GET', '/v1/staff/meters/123', { token: editorToken });
  assert.equal(missing.status, 404);
});

test('content: defaults, sanitised saves, versions, restore', async () => {
  const pub = await api.call('GET', '/v1/public/content/site');
  assert.equal(pub.status, 200);
  assert.equal(pub.body.data.home.headline.length, 4);
  assert.equal(pub.body.version, 0);

  const current = await api.call('GET', '/v1/staff/content/site', { token: editorToken });
  const doc = structuredClone(current.body.data);
  doc.home.headline = ['Power', 'made', 'simple', 'today'];
  doc.download.androidUrl = 'https://play.google.com/store/apps/details?id=com.smeter.smeter';
  doc.evil = { injected: true }; // unknown keys are dropped
  const saved = await api.call('PUT', '/v1/staff/content/site', { token: editorToken, body: { data: doc, version: 0 } });
  assert.equal(saved.status, 200, saved.text);
  assert.equal(saved.body.version, 1);
  assert.equal(saved.body.data.evil, undefined);

  const stale = await api.call('PUT', '/v1/staff/content/site', { token: editorToken, body: { data: doc, version: 0 } });
  assert.equal(stale.status, 409);

  const badImg = structuredClone(saved.body.data);
  badImg.images.tenant = 'javascript:alert(1)';
  const rejected = await api.call('PUT', '/v1/staff/content/site', { token: editorToken, body: { data: badImg } });
  assert.equal(rejected.status, 400);

  const badType = structuredClone(saved.body.data);
  badType.home.headline = 'not a list';
  assert.equal((await api.call('PUT', '/v1/staff/content/site', { token: editorToken, body: { data: badType } })).status, 400);

  const pub2 = await api.call('GET', '/v1/public/content/site');
  assert.deepEqual(pub2.body.data.home.headline, ['Power', 'made', 'simple', 'today']);
  assert.ok(pub2.body.data.product.faqs.length > 0, 'untouched defaults still merged in');

  const restored = await api.call('POST', '/v1/staff/content/site/reset', { token: editorToken });
  assert.equal(restored.body.data.home.headline[0], 'Buy power');
  const back = await api.call('POST', '/v1/staff/content/site/restore', { token: editorToken, body: { version: 1 } });
  assert.equal(back.body.data.home.headline[0], 'Power');
  assert.equal(back.body.history[0].by, 'Ed');

  const app = await api.call('GET', '/v1/public/content/app');
  assert.equal(app.body.data.onboarding.length, 5);
  assert.equal((await api.call('GET', '/v1/public/content/nope')).status, 404);
});

test('website leads and notify sign-ups', async () => {
  resetRateLimits();
  const lead = await api.call('POST', '/v1/public/owner-leads', {
    body: { fullName: 'Tunde Bakare', phone: '0803 111 2222', email: 'tunde@example.com', city: 'Ibadan', propertyType: 'apartments', units: 12 },
  });
  assert.equal(lead.status, 201, lead.text);
  const spam = await api.call('POST', '/v1/public/owner-leads', { body: { fullName: 'Bot', phone: '08031112222', website: 'http://x' } });
  assert.equal(spam.status, 400);
  const badPhone = await api.call('POST', '/v1/public/owner-leads', { body: { fullName: 'Tunde', phone: '12' } });
  assert.equal(badPhone.status, 400);

  const leads = await api.call('GET', '/v1/staff/leads', { token: editorToken });
  assert.equal(leads.body.data[0].phone, '+2348031112222');
  const upd = await api.call('PATCH', `/v1/staff/leads/${leads.body.data[0].id}`, { token: editorToken, body: { status: 'contacted', note: 'Called' } });
  assert.equal(upd.status, 200);

  assert.equal((await api.call('POST', '/v1/public/notify', { body: { contact: 'me@example.com', platform: 'ios' } })).status, 201);
  assert.equal((await api.call('POST', '/v1/public/notify', { body: { contact: 'ME@example.com', platform: 'ios' } })).status, 201); // de-duplicated
  const n = await api.call('GET', '/v1/staff/notify-requests', { token: editorToken });
  assert.equal(n.body.data.length, 1);
});

test('image uploads are type-checked', async () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b00000000049454e44ae426082', 'hex');
  const ok = await fetch(`${api.base}/v1/staff/uploads`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${editorToken}`, 'Content-Type': 'image/png' },
    body: png,
  });
  assert.equal(ok.status, 201);
  const { url } = await ok.json();
  const served = await fetch(api.base + url);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), png); // round-trips through the database
  assert.equal((await fetch(`${api.base}/uploads/nope.png`)).status, 404);

  const bad = await fetch(`${api.base}/v1/staff/uploads`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${editorToken}`, 'Content-Type': 'image/png' },
    body: Buffer.from('<svg onload=alert(1)></svg> padding padding'),
  });
  assert.equal(bad.status, 400);
});

test('payment settings: owners edit, editors view, changes reach pricing and checkout', async () => {
  resetRateLimits();
  const view = await api.call('GET', '/v1/staff/settings/payments', { token: editorToken });
  assert.equal(view.status, 200, view.text);
  assert.deepEqual(view.body.settings.channels, ['card', 'bank_transfer', 'ussd']);
  assert.equal(view.body.settings.feePercent, 1.5);
  assert.equal(view.body.channelOptions.length, 3);

  const next = { ...view.body.defaults, channels: ['card', 'ussd'], feePercent: 2, feeFlatNaira: 0, minPurchaseNaira: 1000 };
  const editorSave = await api.call('PUT', '/v1/staff/settings/payments', { token: editorToken, body: next });
  assert.equal(editorSave.status, 403);

  const invalid = await api.call('PUT', '/v1/staff/settings/payments', { token: staffToken, body: { ...next, channels: [] } });
  assert.equal(invalid.status, 400);
  assert.match(invalid.body.error.message, /at least one payment channel/);
  const backwards = await api.call('PUT', '/v1/staff/settings/payments', { token: staffToken, body: { ...next, minPurchaseNaira: 9_000_000 } });
  assert.equal(backwards.status, 400);
  assert.equal((await api.call('PUT', '/v1/staff/settings/payments', { token: staffToken, body: { ...next, channels: ['cash'] } })).status, 400);

  const saved = await api.call('PUT', '/v1/staff/settings/payments', { token: staffToken, body: next });
  assert.equal(saved.status, 200, saved.text);
  assert.deepEqual(saved.body.settings.channels, ['card', 'ussd']);
  assert.equal(saved.body.settings.updatedBy, 'Ops Owner');

  // The app sees the new options.
  const opts = await api.call('GET', '/v1/public/payment-options');
  assert.deepEqual(opts.body, { channels: ['card', 'ussd'], minPurchase: 1000, maxPurchase: 500000 });
  const appContent = await api.call('GET', '/v1/public/content/app');
  assert.deepEqual(appContent.body.data.payments.channels, ['card', 'ussd']);

  // Pricing and checkout use them: tenant on the seeded meter.
  const start = await api.call('POST', '/v1/auth/tenant/start', { body: { meterId: '47009990001' } });
  const verify = await api.call('POST', '/v1/auth/tenant/verify', { body: { meterId: '47009990001', code: start.body.devCode } });
  const tenant = verify.body.token;
  const tooSmall = await api.call('POST', '/v1/tenant/quote', { token: tenant, body: { amount: 800 } });
  assert.equal(tooSmall.status, 400);
  assert.match(tooSmall.body.error.message, /Minimum purchase is ₦1000/);
  const q = await api.call('POST', '/v1/tenant/quote', { token: tenant, body: { amount: 5000 } });
  assert.equal(q.status, 200, q.text);
  // 2% with no flat fee, grossed up to ₦5,102.04 (fee ₦102.04) so ₦5,000 arrives
  assert.equal(q.body.quote.total, 5102.04);
  const transfer = await api.call('POST', '/v1/tenant/purchases', { token: tenant, body: { amount: 5000, channel: 'bank_transfer' } });
  assert.equal(transfer.status, 400);
  assert.match(transfer.body.error.message, /isn’t available/);
  const card = await api.call('POST', '/v1/tenant/purchases', { token: tenant, body: { amount: 5000, channel: 'card' } });
  assert.equal(card.status, 201, card.text);

  // Reset restores the env defaults.
  const reset = await api.call('POST', '/v1/staff/settings/payments/reset', { token: staffToken });
  assert.equal(reset.status, 200);
  assert.deepEqual(reset.body.settings.channels, ['card', 'bank_transfer', 'ussd']);
  assert.equal(reset.body.settings.updatedAt, null);
});

test('unit price limits: owners edit, limits reach owners, impact is reported', async () => {
  resetRateLimits();
  const view = await api.call('GET', '/v1/staff/settings/tariff', { token: editorToken });
  assert.equal(view.status, 200, view.text);
  assert.deepEqual(view.body.defaults, { maxUnitPriceNaira: 250, baseUnitCostNaira: 209.5 });
  assert.equal(view.body.impact.priced, 1); // Ada priced at ₦230

  assert.equal((await api.call('PUT', '/v1/staff/settings/tariff', { token: editorToken, body: { maxUnitPriceNaira: 300, baseUnitCostNaira: 200 } })).status, 403);
  const inverted = await api.call('PUT', '/v1/staff/settings/tariff', { token: staffToken, body: { maxUnitPriceNaira: 200, baseUnitCostNaira: 210 } });
  assert.equal(inverted.status, 400);
  assert.match(inverted.body.error.message, /below the maximum/);

  // Preview: a utility cost above Ada's price would stop her tenants buying.
  const preview = await api.call('POST', '/v1/staff/settings/tariff/preview', { token: editorToken, body: { maxUnitPriceNaira: 300, baseUnitCostNaira: 240 } });
  assert.equal(preview.body.impact.belowCost, 1);

  const saved = await api.call('PUT', '/v1/staff/settings/tariff', { token: staffToken, body: { maxUnitPriceNaira: 300, baseUnitCostNaira: 200 } });
  assert.equal(saved.status, 200, saved.text);
  assert.equal(saved.body.settings.updatedBy, 'Ops Owner');
  assert.deepEqual(saved.body.impact, { aboveMax: 0, belowCost: 0, priced: 1 });

  // The owner sees and is held to the new limits.
  const login = await api.call('POST', '/v1/auth/landlord/login', { body: { identifier: 'ada@example.com', password: 'correct-horse' } });
  const owner = login.body.token;
  const me = await api.call('GET', '/v1/landlord/me', { token: owner });
  assert.deepEqual(me.body.landlord.tariffLimits, { max: 300, baseCost: 200 });
  assert.equal((await api.call('PUT', '/v1/landlord/tariff', { token: owner, body: { unitPrice: 280 } })).status, 200); // above the old ₦250 cap
  assert.equal((await api.call('PUT', '/v1/landlord/tariff', { token: owner, body: { unitPrice: 301 } })).status, 400);
  const floor = await api.call('PUT', '/v1/landlord/tariff', { token: owner, body: { unitPrice: 199 } });
  assert.equal(floor.status, 400);
  assert.match(floor.body.error.message, /utility cost of ₦200/);

  const reset = await api.call('POST', '/v1/staff/settings/tariff/reset', { token: staffToken });
  assert.equal(reset.body.settings.maxUnitPriceNaira, 250);
  assert.equal(reset.body.impact.aboveMax, 1); // Ada is now at ₦280, above the default cap
});

test('head-end connection: owners only, secrets encrypted and never returned', async () => {
  resetRateLimits();
  assert.equal((await api.call('GET', '/v1/staff/settings/geni', { token: editorToken })).status, 403);
  const view = await api.call('GET', '/v1/staff/settings/geni', { token: staffToken });
  assert.equal(view.status, 200, view.text);
  assert.equal(view.body.settings.mode, 'mock');
  assert.equal('password' in view.body.settings, false);

  // Real head-end needs a username and password.
  const noPass = await api.call('PUT', '/v1/staff/settings/geni', { token: staffToken, body: { mode: 'live', baseUrl: 'http://8.208.24.83:9200', company: 'Geni', userId: 'admin' } });
  assert.equal(noPass.status, 400);

  // Save with secrets while staying on the simulated head-end.
  const saved = await api.call('PUT', '/v1/staff/settings/geni', {
    token: staffToken,
    body: { mode: 'mock', baseUrl: 'http://8.208.24.83:9200/', company: 'Geni', userId: 'admin', password: 'p4ss-word', authorizationPassword: 'auth-9' },
  });
  assert.equal(saved.status, 200, saved.text);
  assert.equal(saved.body.settings.baseUrl, 'http://8.208.24.83:9200');
  assert.equal(saved.body.settings.passwordSet, true);
  assert.equal(saved.body.settings.authorizationPasswordSet, true);
  assert.ok(!saved.text.includes('p4ss-word') && !saved.text.includes('auth-9'), 'secrets never returned');
  const row = await db().get("SELECT data FROM settings WHERE key = 'geni'");
  assert.ok(!row.data.includes('p4ss-word'), 'password stored encrypted');

  // Blank secrets keep the stored ones; the server reads them back decrypted.
  const again = await api.call('PUT', '/v1/staff/settings/geni', { token: staffToken, body: { mode: 'mock', baseUrl: 'http://8.208.24.83:9200', company: 'Geni', userId: 'admin2' } });
  assert.equal(again.body.settings.passwordSet, true);
  const { getGeniSettings } = await import('../src/services/settings.js');
  const effective = await getGeniSettings({ fresh: true });
  assert.equal(effective.password, 'p4ss-word');
  assert.equal(effective.userId, 'admin2');

  const reset = await api.call('POST', '/v1/staff/settings/geni/reset', { token: staffToken });
  assert.equal(reset.body.settings.passwordSet, false);
});
