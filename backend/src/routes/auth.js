import { Router } from 'express';
import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';
import { config } from '../config.js';
import { db, now } from '../db.js';
import { consumeOtp, issueOtp, otpEcho } from '../auth/otp.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { signAccessToken } from '../auth/tokens.js';
import { codeEmail, maskEmail, sendEmail } from '../providers/email.js';
import { notify } from '../services/notifications.js';
import { badRequest, conflict, notFound, unauthorized } from '../util/errors.js';
import { parse } from '../util/http.js';
import { normalizePhone } from '../util/phone.js';
import { rateLimit } from '../util/rateLimit.js';
import { landlordDto, tenantDto } from './dto.js';

export const authRoutes = Router();

const phoneField = z.string().transform((v, ctx) => {
  const p = normalizePhone(v);
  if (!p) ctx.addIssue({ code: 'custom', message: 'Enter a valid phone number' });
  return p ?? '';
});
const password = z.string().min(8, 'Password must be at least 8 characters').max(200);
const meterIdField = z.string().trim().regex(/^\d{6,20}$/, 'Enter the meter number printed on your meter');

const authLimiter = rateLimit({ key: 'auth', limit: 20, windowMs: 15 * 60 * 1000 });
const otpLimiter = rateLimit({ key: 'otp', limit: 8, windowMs: 15 * 60 * 1000 });

// ---- Landlord (property owner) -------------------------------------------

authRoutes.post('/landlord/register', authLimiter, async (req, res) => {
  const body = parse(
    z.object({
      fullName: z.string().trim().min(2, 'Enter your full name').max(120),
      email: z.string().trim().toLowerCase().email('Enter a valid email address'),
      phone: phoneField,
      password,
    }),
    req.body,
  );
  const clash = await db().get('SELECT email, phone FROM landlords WHERE email = ? OR phone = ?', body.email, body.phone);
  if (clash) {
    throw conflict(clash.email === body.email ? 'An account with this email already exists' : 'An account with this phone number already exists');
  }
  const passwordHash = await hashPassword(body.password);
  let landlord;
  try {
    landlord = await db().get(
      'INSERT INTO landlords (full_name, email, phone, password_hash) VALUES (?, ?, ?, ?) RETURNING *',
      body.fullName, body.email, body.phone, passwordHash,
    );
  } catch (err) {
    if (err.code === '23505') throw conflict('An account with this email or phone number already exists');
    throw err;
  }
  res.status(201).json({ token: await signAccessToken({ role: 'landlord', sub: landlord.id }), landlord: landlordDto(landlord) });
});

authRoutes.post('/landlord/login', authLimiter, async (req, res) => {
  const body = parse(z.object({ identifier: z.string().trim().min(3), password: z.string().min(1).max(200) }), req.body);
  const phone = normalizePhone(body.identifier);
  const landlord = await db().get(
    'SELECT * FROM landlords WHERE email = ? OR phone = ?',
    body.identifier.toLowerCase(), phone ?? '',
  );
  // Same error for unknown user and wrong password.
  if (!landlord || !(await verifyPassword(body.password, landlord.password_hash))) {
    throw unauthorized('Incorrect email/phone or password');
  }
  res.json({ token: await signAccessToken({ role: 'landlord', sub: landlord.id }), landlord: landlordDto(landlord) });
});

// ---- Password reset by email code (SM-SEC-001) ----------------------------
// The owner identifies themselves by email or phone; the code always goes to
// the account's email address.

const resetKey = () => new TextEncoder().encode(`${config.jwtSecret}:password-reset`);

// Accepts { identifier } (email or phone); older app builds send { phone }.
const accountIdentifier = z
  .object({ identifier: z.string().trim().optional(), email: z.string().trim().optional(), phone: z.string().trim().optional() })
  .transform((b, ctx) => {
    const v = b.identifier || b.email || b.phone || '';
    if (v.length < 3) ctx.addIssue({ code: 'custom', message: 'Enter your email or phone number', path: ['identifier'] });
    return v;
  });

async function findAccount(identifier) {
  const landlord = await db().get(
    'SELECT id, email FROM landlords WHERE email = ? OR phone = ?',
    identifier.toLowerCase(), normalizePhone(identifier) ?? '',
  );
  if (!landlord) throw notFound('We couldn’t find an account with that email or phone number');
  return landlord;
}

authRoutes.post('/password/forgot', otpLimiter, async (req, res) => {
  const identifier = parse(accountIdentifier, req.body);
  const landlord = await findAccount(identifier);
  const code = await issueOtp({ purpose: 'password_reset', subject: `landlord:${landlord.id}` });
  await sendEmail(codeEmail({ to: landlord.email, purpose: 'password reset', code }));
  res.json({ sentTo: maskEmail(landlord.email), channel: 'email', expiresInMinutes: config.otp.ttlMinutes, ...otpEcho(code) });
});

authRoutes.post('/password/verify', otpLimiter, async (req, res) => {
  const identifier = parse(accountIdentifier, req.body);
  const { code } = parse(z.object({ code: z.string().trim() }).passthrough(), req.body);
  const landlord = await findAccount(identifier);
  await consumeOtp({ purpose: 'password_reset', subject: `landlord:${landlord.id}`, code });
  const resetToken = await new SignJWT({ sub: String(landlord.id) })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('10m')
    .sign(resetKey());
  res.json({ resetToken });
});

authRoutes.post('/password/reset', authLimiter, async (req, res) => {
  const body = parse(z.object({ resetToken: z.string().min(10), newPassword: password }), req.body);
  let id;
  try {
    ({ payload: { sub: id } } = await jwtVerify(body.resetToken, resetKey(), { algorithms: ['HS256'] }));
  } catch {
    throw badRequest('This reset session has expired. Start again.');
  }
  const r = await db().run('UPDATE landlords SET password_hash = ? WHERE id = ?', await hashPassword(body.newPassword), Number(id));
  if (r.changes !== 1) throw badRequest('This reset session has expired. Start again.');
  res.json({ ok: true });
});

// ---- Tenant: meter number → emailed code to the address the owner registered ---

const linkedMeter = (meterId) =>
  db().get("SELECT * FROM meters WHERE meter_id = ? AND status IN ('invited','active')", meterId);

authRoutes.post('/tenant/start', otpLimiter, async (req, res) => {
  const { meterId } = parse(z.object({ meterId: meterIdField }), req.body);
  const meter = await linkedMeter(meterId);
  if (!meter) {
    throw notFound("This meter number isn't registered on smeter yet. Ask your property owner to add it.");
  }
  if (!meter.tenant_email) {
    throw conflict('There’s no email address on this meter yet. Ask your property owner to add your email in the smeter app.');
  }
  const code = await issueOtp({ purpose: 'tenant_login', subject: meterId });
  await sendEmail(codeEmail({ to: meter.tenant_email, purpose: 'login', code, detail: `For meter ${meterId}.` }));
  res.json({ sentTo: maskEmail(meter.tenant_email), channel: 'email', expiresInMinutes: config.otp.ttlMinutes, ...otpEcho(code) });
});

authRoutes.post('/tenant/verify', otpLimiter, async (req, res) => {
  const { meterId, code } = parse(z.object({ meterId: meterIdField, code: z.string().trim() }), req.body);
  await consumeOtp({ purpose: 'tenant_login', subject: meterId, code });
  const meter = await linkedMeter(meterId);
  if (!meter) throw notFound('Meter not found');
  if (meter.status === 'invited') {
    // First successful login is the tenant accepting the meter link.
    await db().run("UPDATE meters SET status = 'active', accepted_at = ? WHERE id = ?", now(), meter.id);
    await notify({
      recipientType: 'landlord', recipientId: meter.landlord_id, kind: 'tenant_joined',
      title: 'Tenant connected',
      body: `The tenant on meter ${meterId}${meter.apartment ? ` (Apt ${meter.apartment})` : ''} accepted the link and can now buy power.`,
    });
  }
  const fresh = await db().get('SELECT * FROM meters WHERE id = ?', meter.id);
  const landlord = await db().get('SELECT * FROM landlords WHERE id = ?', fresh.landlord_id);
  res.json({ token: await signAccessToken({ role: 'tenant', sub: meterId }), tenant: tenantDto(fresh, landlord) });
});
