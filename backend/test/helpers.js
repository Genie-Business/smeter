// Boot the app against an in-memory DB with every integration mocked.
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = ':memory:';
process.env.UPLOAD_DIR = (await import('node:path')).join((await import('node:os')).tmpdir(), 'smeter-test-uploads');
process.env.GENI_MODE = 'mock';
process.env.PAYMENTS_PROVIDER = 'mock';
process.env.SMS_PROVIDER = 'log';
process.env.OTP_DEBUG_ECHO = 'true';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret';

const { createApp } = await import('../src/app.js');
const { openDb, setDb } = await import('../src/db.js');
const { resetRateLimits } = await import('../src/util/rateLimit.js');

export async function startServer() {
  setDb(openDb(':memory:'));
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

  return { base, call, close: () => new Promise((r) => server.close(r)) };
}
