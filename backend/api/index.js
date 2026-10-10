// Vercel serverless entry. Every request is rewritten here (see vercel.json)
// and handed to the same Express app that `npm start` runs.
//
// Data lives in Neon Postgres (DATABASE_URL). The payment-audit sweeper is a
// Vercel cron hitting /internal/sweep (see vercel.json) instead of a timer.

let ready;

async function boot() {
  try {
    const { assertConfig } = await import('../src/config.js');
    assertConfig();
    const { initDb } = await import('../src/db.js');
    await initDb();
    const { bootstrapStaff } = await import('../src/routes/staff.js');
    await bootstrapStaff();
    const { createApp } = await import('../src/app.js');
    return createApp();
  } catch (err) {
    console.error('[boot] smeter API failed to start:', err);
    ready = undefined; // retry on the next request (e.g. database briefly unreachable)
    // Answer with the reason instead of crashing the function. The messages
    // name missing env vars only, never their values.
    const body = JSON.stringify({
      error: { code: 'misconfigured', message: String(err?.message ?? err) },
    });
    return (_req, res) => {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json');
      res.end(body);
    };
  }
}

export default async function handler(req, res) {
  ready ??= boot();
  const app = await ready;
  return app(req, res);
}
