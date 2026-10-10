// Vercel serverless entry. Every request is rewritten here (see vercel.json)
// and handed to the same Express app that `npm start` runs.
//
// Caveats on Vercel: the SQLite file lives in /tmp, which is per-instance and
// wiped on cold starts, and the payment-audit sweeper (a setInterval) doesn't
// run. Fine for a staging demo; production needs a real database and a cron.

let ready;

async function boot() {
  try {
    const { assertConfig } = await import('../src/config.js');
    assertConfig();
    const { db } = await import('../src/db.js');
    db();
    const { bootstrapStaff } = await import('../src/routes/staff.js');
    await bootstrapStaff();
    const { createApp } = await import('../src/app.js');
    return createApp();
  } catch (err) {
    console.error('[boot] smeter API failed to start:', err);
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
