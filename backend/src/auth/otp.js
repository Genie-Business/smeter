import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { db, now } from '../db.js';
import { badRequest, tooMany } from '../util/errors.js';

const hash = (code) => createHash('sha256').update(`${config.jwtSecret}:${code}`).digest();

/** Issue a 6-digit code, invalidating earlier unconsumed codes for the same subject. */
export function issueOtp({ purpose, subject, payload }) {
  const recent = db()
    .prepare(
      `SELECT COUNT(*) AS n FROM otps WHERE purpose = ? AND subject = ? AND created_at > ?`,
    )
    .get(purpose, subject, new Date(Date.now() - 60 * 60 * 1000).toISOString());
  if (recent.n >= 5) throw tooMany('Too many codes requested. Try again in an hour.');

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const expires = new Date(Date.now() + config.otp.ttlMinutes * 60 * 1000).toISOString();
  db()
    .prepare(`UPDATE otps SET consumed_at = ? WHERE purpose = ? AND subject = ? AND consumed_at IS NULL`)
    .run(now(), purpose, subject);
  db()
    .prepare(`INSERT INTO otps (purpose, subject, code_hash, payload, expires_at) VALUES (?, ?, ?, ?, ?)`)
    .run(purpose, subject, hash(code).toString('hex'), payload ? JSON.stringify(payload) : null, expires);
  return code;
}

/** Verify and consume a code; returns the stashed payload (or {}). */
export function consumeOtp({ purpose, subject, code }) {
  const row = db()
    .prepare(
      `SELECT * FROM otps WHERE purpose = ? AND subject = ? AND consumed_at IS NULL
       ORDER BY id DESC LIMIT 1`,
    )
    .get(purpose, subject);
  if (!row) throw badRequest('Request a new code and try again');
  if (row.expires_at < now()) throw badRequest('This code has expired. Request a new one.');
  if (row.attempts >= config.otp.maxAttempts) throw tooMany('Too many wrong attempts. Request a new code.');

  const ok =
    /^\d{6}$/.test(String(code)) &&
    timingSafeEqual(Buffer.from(row.code_hash, 'hex'), hash(String(code)));
  if (!ok) {
    db().prepare('UPDATE otps SET attempts = attempts + 1 WHERE id = ?').run(row.id);
    throw badRequest('That code is incorrect');
  }
  db().prepare('UPDATE otps SET consumed_at = ? WHERE id = ?').run(now(), row.id);
  return row.payload ? JSON.parse(row.payload) : {};
}

/** Extra fields to merge into a response when OTP echo is enabled (dev only). */
export const otpEcho = (code) => (config.otp.echo ? { devCode: code } : {});
