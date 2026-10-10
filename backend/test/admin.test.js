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
  db()
    .prepare("INSERT INTO staff (email, name, password_hash, role) VALUES (?, ?, ?, 'owner')")
    .run('ops@smeter.test', 'Ops Owner', await hashPassword('owner-password-1'));
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
    body: { meterId: '47009990001', address: '3 Allen Ave, Ikeja', apartment: '4', tenantPhone: '08036660000', deliveryMode: 'manual' },
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

  const bad = await fetch(`${api.base}/v1/staff/uploads`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${editorToken}`, 'Content-Type': 'image/png' },
    body: Buffer.from('<svg onload=alert(1)></svg> padding padding'),
  });
  assert.equal(bad.status, 400);
});
