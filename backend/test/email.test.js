import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.RESEND_API_KEY = 're_test_key';
process.env.EMAIL_FROM = 'smeter <no-reply@smeter.example>';
delete process.env.EMAIL_PROVIDER;

const { codeEmail, inviteEmail, maskEmail, sendEmail } = await import('../src/providers/email.js');

test('codes are sent through the Resend API', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ id: 'email_123' }), { status: 200 });
  };
  try {
    const ok = await sendEmail(codeEmail({ to: 'ada@example.com', purpose: 'login', code: '482913', detail: 'For meter 47001234567.' }));
    assert.equal(ok, true);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer re_test_key');
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.to, ['ada@example.com']);
  assert.equal(body.from, 'smeter <no-reply@smeter.example>');
  assert.equal(body.subject, '482913 is your smeter login code');
  assert.match(body.text, /482913/);
  assert.match(body.html, /482913/);
});

test('a Resend failure never breaks the request', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{"message":"domain not verified"}', { status: 403 });
  const realError = console.error;
  console.error = () => {};
  try {
    assert.equal(await sendEmail(inviteEmail({ to: 'x@example.com', ownerName: 'Ada', meterId: '47001234567' })), false);
  } finally {
    globalThis.fetch = realFetch;
    console.error = realError;
  }
});

test('email addresses are masked for display', () => {
  assert.equal(maskEmail('daniell@example.com'), 'd******@example.com');
  assert.equal(maskEmail('jo@x.ng'), 'j**@x.ng');
  assert.equal(maskEmail('not-an-email'), '');
});
