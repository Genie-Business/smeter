// Gateway webhooks (SM-PAY-002), the checkout return page and the local mock
// checkout used until Paystack keys are configured.
import express, { Router } from 'express';
import { config } from '../config.js';
import { db } from '../db.js';
import { payments } from '../providers/payments.js';
import { getPurchase, settlePayment } from '../services/vending.js';
import { notFound } from '../util/errors.js';
import { koboToNaira } from '../util/http.js';

export const webhookRoutes = Router();

// Raw body is required to check the HMAC signature byte-for-byte.
webhookRoutes.post('/paystack', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  const provider = payments();
  if (provider.name !== 'paystack' || !provider.verifyWebhook(req.body, req.get('x-paystack-signature'))) {
    return res.status(401).json({ error: { code: 'invalid_signature', message: 'Invalid signature' } });
  }
  let event;
  try {
    event = JSON.parse(req.body.toString('utf8'));
  } catch {
    return res.status(400).end();
  }
  // Settle before acknowledging: serverless hosts may freeze the function once
  // the response is sent. Processing is idempotent; on failure the event is
  // forgotten so Paystack's retry (or the sweeper) picks it up again.
  // The Paystack account is shared with other company products: acknowledge and
  // skip any charge that isn't one of our purchases.
  const ours = event?.data?.reference && (await getPurchase(String(event.data.reference)));
  if (event?.event === 'charge.success' && ours) {
    const eventId = `paystack:${event.data.id ?? event.data.reference}`;
    const seen = await db().run(
      'INSERT INTO webhook_events (id, provider, event) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING',
      eventId, 'paystack', event.event,
    );
    if (seen.changes === 1) {
      try {
        await settlePayment(String(event.data.reference), { source: 'webhook' });
      } catch (err) {
        console.error('[webhook] settle failed', event.data.reference, err.message);
        await db().run('DELETE FROM webhook_events WHERE id = ?', eventId);
      }
    }
  }
  res.status(200).json({ received: true });
});

export const payPages = Router();

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>
  :root{--p:#9D10A9;--ink:#1f2937;--muted:#6b7280}
  *{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--p);color:var(--ink);min-height:100vh;display:grid;place-items:center;padding:16px}
  .card{background:#fff;border-radius:20px;padding:28px 24px;max-width:380px;width:100%;box-shadow:0 10px 30px rgba(0,0,0,.15)}
  h1{font-size:20px;margin:0 0 4px;color:var(--p)}p{color:var(--muted);margin:6px 0 18px;line-height:1.5}
  .amt{font-size:34px;font-weight:700;color:var(--p);margin:8px 0 16px}
  button,a.btn{display:block;width:100%;border:0;border-radius:12px;padding:15px;font-size:16px;font-weight:600;margin-top:10px;cursor:pointer;text-align:center;text-decoration:none}
  .go{background:var(--p);color:#fff}.no{background:#f3f4f6;color:var(--ink)}
  .tag{display:inline-block;background:#fdf2fd;color:var(--p);border-radius:999px;padding:4px 10px;font-size:12px;font-weight:600}
</style></head><body><div class="card">${body}</div></body></html>`;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const appLink = (reference) => `${config.appScheme}://payment?reference=${encodeURIComponent(reference)}`;

// Gateway redirect target: settle (in case the webhook is late) and bounce to the app.
payPages.get('/return', async (req, res) => {
  // Paystack appends ?reference=&trxref= to our callback URL, which already
  // carries ?reference=, so the parameter can arrive as an array.
  const first = (v) => (Array.isArray(v) ? v[0] : v);
  const reference = String(first(req.query.reference) ?? first(req.query.trxref) ?? '');
  let status = 'pending';
  try {
    status = (await settlePayment(reference, { source: 'callback' })).status;
  } catch {
    /* unknown reference: still bounce to the app, which shows the error */
  }
  const ok = ['paid', 'vending', 'vended'].includes(status);
  res
    .type('html')
    .send(page('smeter payment', `<span class="tag">smeter</span>
      <h1>${ok ? 'Payment received' : status === 'failed' ? 'Payment not completed' : 'Confirming payment...'}</h1>
      <p>${ok ? 'Your units are being sent to your meter.' : 'You can return to the app to check the status.'}</p>
      <a class="btn go" href="${esc(appLink(reference))}">Return to smeter</a>
      <script>setTimeout(function(){location.href=${JSON.stringify(appLink(reference))}},800)</script>`));
});

// ---- Mock checkout (only when PAYMENTS_PROVIDER=mock) -----------------------

payPages.get('/mock/:reference', async (req, res) => {
  if (payments().name !== 'mock') throw notFound();
  const p = await getPurchase(req.params.reference);
  if (!p) throw notFound('Unknown payment');
  const amount = koboToNaira(p.total_kobo).toLocaleString('en-NG', { minimumFractionDigits: 2 });
  const action = `/pay/mock/${encodeURIComponent(p.reference)}`;
  res.type('html').send(page('Test checkout', `<span class="tag">Test checkout · no real money</span>
    <h1>Pay for power</h1><p>Meter ${esc(p.meter_id)} · ref ${esc(p.reference)}</p>
    <div class="amt">₦${esc(amount)}</div>
    <form method="post" action="${esc(action)}"><input type="hidden" name="outcome" value="success">
      <button class="go" type="submit">Pay ₦${esc(amount)}</button></form>
    <form method="post" action="${esc(action)}"><input type="hidden" name="outcome" value="failed">
      <button class="no" type="submit">Decline payment</button></form>`));
});

payPages.post('/mock/:reference', express.urlencoded({ extended: false }), async (req, res) => {
  const provider = payments();
  if (provider.name !== 'mock') throw notFound();
  const reference = req.params.reference;
  if (!(await getPurchase(reference))) throw notFound('Unknown payment');
  await provider.complete(reference, req.body?.outcome === 'success');
  res.redirect(303, `/pay/return?reference=${encodeURIComponent(reference)}`);
});
