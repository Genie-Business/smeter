// App store requirements: owners can delete (deactivate) their account, and the
// review demo meter signs in with a fixed code when configured.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.REVIEW_METER_ID = '47009990077';
process.env.REVIEW_LOGIN_CODE = '246810';
const { completeOwnerSetup, startServer } = await import('./helpers.js');

let api;
let owner;
before(async () => {
  api = await startServer();
  const reg = await api.call('POST', '/v1/auth/landlord/register', {
    body: { fullName: 'Review Owner', email: 'review@example.com', phone: '08036661234', password: 'correct-horse' },
  });
  owner = reg.body.token;
  await completeOwnerSetup(api, owner);
});
after(() => api.close());

test('the review meter signs in with the fixed code; other meters still need an emailed one', async () => {
  for (const meterId of ['47009990077', '47009990078']) {
    const add = await api.call('POST', '/v1/landlord/meters', {
      token: owner, body: { meterId, address: '1 Review Close, Lagos', tenantPhone: '08025551234', tenantEmail: `t${meterId}@example.com` },
    });
    assert.equal(add.status, 201, add.text);
  }
  const start = await api.call('POST', '/v1/auth/tenant/start', { body: { meterId: '47009990077' } });
  assert.equal(start.status, 200);
  assert.equal(start.body.devCode, undefined); // nothing is sent for the review meter
  const wrong = await api.call('POST', '/v1/auth/tenant/verify', { body: { meterId: '47009990077', code: '111111' } });
  assert.equal(wrong.status, 400);
  const ok = await api.call('POST', '/v1/auth/tenant/verify', { body: { meterId: '47009990077', code: '246810' } });
  assert.equal(ok.status, 200, ok.text);
  assert.ok(ok.body.token);

  // The fixed code only works for the review meter.
  await api.call('POST', '/v1/auth/tenant/start', { body: { meterId: '47009990078' } });
  const other = await api.call('POST', '/v1/auth/tenant/verify', { body: { meterId: '47009990078', code: '246810' } });
  assert.equal(other.status, 400);
});

test('an owner deletes their account: confirmed by password, then no sign-in or password reset', async () => {
  const wrong = await api.call('POST', '/v1/landlord/me/delete', { token: owner, body: { password: 'nope-nope' } });
  assert.equal(wrong.status, 400);
  const del = await api.call('POST', '/v1/landlord/me/delete', { token: owner, body: { password: 'correct-horse' } });
  assert.equal(del.status, 200, del.text);

  assert.equal((await api.call('GET', '/v1/landlord/me', { token: owner })).status, 401); // existing session ends
  const login = await api.call('POST', '/v1/auth/landlord/login', { body: { identifier: 'review@example.com', password: 'correct-horse' } });
  assert.equal(login.status, 401);
  assert.match(login.body.error.message, /deleted/);
  const reset = await api.call('POST', '/v1/auth/password/forgot', { body: { identifier: 'review@example.com' } });
  assert.equal(reset.status, 404);
});
