import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { db, now } from '../db.js';
import { badRequest, tooMany } from '../util/errors.js';

const hash = (code) => createHash('sha256').update(`${config.jwtSecret}:${code}`).digest();

/** Issue a 6-digit code, invalidating earlier unconsumed codes for the same subject. */
export async function issueOtp({ purpose, subject, payload }) {
  const recent = await db().get(
    `SELECT COUNT(*) AS n FROM otps WHERE purpose = ? AND subject = ? AND created_at > ?`,
    purpose, subject, new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  );
  if (recent.n >= 5) throw tooMany('Too many codes requested. Try again in an hour.');

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const expires = new Date(Date.now() + config.otp.ttlMinutes * 60 * 1000).toISOString();
  await db().run(
    `UPDATE otps SET consumed_at = ? WHERE purpose = ? AND subject = ? AND consumed_at IS NULL`,
    now(), purpose, subject,
  );
  await db().run(
    `INSERT INTO otps (purpose, subject, code_hash, payload, expires_at) VALUES (?, ?, ?, ?, ?)`,
    purpose, subject, hash(code).toString('hex'), payload ? JSON.stringify(payload) : null, expires,
  );
  return code;
}

/** Verify and consume a code; returns the stashed payload (or {}). */
export async function consumeOtp({ purpose, subject, code }) {
  const row = await db().get(
    `SELECT * FROM otps WHERE purpose = ? AND subject = ? AND consumed_at IS NULL
     ORDER BY id DESC LIMIT 1`,
    purpose, subject,
  );
  if (!row) throw badRequest('Request a new code and try again');
  if (row.expires_at < now()) throw badRequest('This code has expired. Request a new one.');
  if (row.attempts >= config.otp.maxAttempts) throw tooMany('Too many wrong attempts. Request a new code.');

  const ok =
    /^\d{6}$/.test(String(code)) &&
    timingSafeEqual(Buffer.from(row.code_hash, 'hex'), hash(String(code)));
  if (!ok) {
    await db().run('UPDATE otps SET attempts = attempts + 1 WHERE id = ?', row.id);
    throw badRequest('That code is incorrect');
  }
  // Conditional on still being unconsumed, so two concurrent verifies can't both win.
  const used = await db().run('UPDATE otps SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL', now(), row.id);
  if (used.changes !== 1) throw badRequest('Request a new code and try again');
  return row.payload ? JSON.parse(row.payload) : {};
}

/** Extra fields to merge into a response when OTP echo is enabled (dev only). */
export const otpEcho = (code) => (config.otp.echo ? { devCode: code } : {});
