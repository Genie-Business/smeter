// Boot the app against an in-memory Postgres (PGlite) with every integration mocked.
process.env.NODE_ENV = 'test';
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
process.env.PGLITE_DIR = 'memory';
process.env.GENI_MODE = 'mock';
process.env.PAYMENTS_PROVIDER = 'mock';
process.env.EMAIL_PROVIDER = 'log';
delete process.env.RESEND_API_KEY;
process.env.OTP_DEBUG_ECHO = 'true';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret';
// No GPRS service charge unless a test sets one (see service-charge.test.js).
process.env.GPRS_FEE_SINGLE_PHASE_NAIRA = '0';
process.env.GPRS_FEE_THREE_PHASE_NAIRA = '0';

const { createApp } = await import('../src/app.js');
const { closeDb, resetDb } = await import('../src/db.js');
const { resetRateLimits } = await import('../src/util/rateLimit.js');

// TEST_DATABASE_URL runs the suite through the `pg` driver (the one used with
// Neon) against a real Postgres server instead of in-process PGlite. It only
// touches a throwaway `smeter_test` schema, never the app's tables.
const testUrl = process.env.TEST_DATABASE_URL;
const TEST_SCHEMA = 'smeter_test';

export async function startServer() {
  if (testUrl) {
    const { db: q } = await import('../src/db.js');
    await resetDb({ url: testUrl });
    await q().run(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await q().run(`CREATE SCHEMA ${TEST_SCHEMA}`);
    await closeDb();
    await new Promise((r) => setTimeout(r, 500)); // let single-connection test servers release the socket
    await resetDb({ url: testUrl, schema: TEST_SCHEMA });
    const { schema } = await q().get('SELECT current_schema() AS schema');
    if (schema !== TEST_SCHEMA) throw new Error(`Tests must run in the ${TEST_SCHEMA} schema, got ${schema}`);
  } else {
    await resetDb({ dir: 'memory' });
  }
  resetRateLimits();
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.PUBLIC_URL = base;

  async function call(method, path, { body, token, form, redirect = 'follow' } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    let payload;
    if (form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      payload = new URLSearchParams(form).toString();
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(base + path, { method, headers, body: payload, redirect });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: res.status, body: json, text, headers: res.headers };
  }

  async function close() {
    await new Promise((r) => server.close(r));
    if (testUrl) {
      const { db: q } = await import('../src/db.js');
      await q().run(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    }
    await closeDb();
  }

  return { base, call, close };
}
