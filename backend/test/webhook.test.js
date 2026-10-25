// Paystack webhook on the shared company account: other products' charges are
// acknowledged and ignored.
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { after, before, test } from 'node:test';

import { startServer } from './helpers.js';

const { config } = await import('../src/config.js');
const { db } = await import('../src/db.js');

let api;
before(async () => {
  api = await startServer();
  config.payments.provider = 'paystack';
  config.payments.paystackSecretKey = 'sk_test_webhook_only';
});
after(() => api.close());

const signed = (event) => {
  const raw = JSON.stringify(event);
  return {
    raw,
    signature: createHmac('sha512', 'sk_test_webhook_only').update(raw).digest('hex'),
  };
};

test("another product's charge is acknowledged and not recorded", async () => {
  const { raw, signature } = signed({ event: 'charge.success', data: { id: 991, reference: 'OTHER-PRODUCT-1' } });
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  let res;
  try {
    res = await fetch(`${api.base}/v1/webhooks/paystack`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-paystack-signature': signature },
      body: raw,
    });
  } finally {
    console.error = original;
  }
  assert.equal(res.status, 200);
  assert.deepEqual(errors, []); // not treated as a failed settle of one of ours
  const row = await db().get('SELECT id FROM webhook_events WHERE id = ?', 'paystack:991');
  assert.equal(row, undefined);
});
