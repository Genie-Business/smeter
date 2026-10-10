import { Router } from 'express';
import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';
import { config } from '../config.js';
import { db, now } from '../db.js';
import { consumeOtp, issueOtp, otpEcho } from '../auth/otp.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { signAccessToken } from '../auth/tokens.js';
import { sendSms } from '../providers/sms.js';
import { notify } from '../services/notifications.js';
import { badRequest, conflict, notFound, unauthorized } from '../util/errors.js';
import { parse } from '../util/http.js';
import { maskPhone, normalizePhone } from '../util/phone.js';
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
  const clash = db()
    .prepare('SELECT email, phone FROM landlords WHERE email = ? OR phone = ?')
    .get(body.email, body.phone);
  if (clash) {
    throw conflict(clash.email === body.email ? 'An account with this email already exists' : 'An account with this phone number already exists');
  }
  const info = db()
    .prepare('INSERT INTO landlords (full_name, email, phone, password_hash) VALUES (?, ?, ?, ?)')
    .run(body.fullName, body.email, body.phone, await hashPassword(body.password));
  const landlord = db().prepare('SELECT * FROM landlords WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ token: await signAccessToken({ role: 'landlord', sub: landlord.id }), landlord: landlordDto(landlord) });
});

authRoutes.post('/landlord/login', authLimiter, async (req, res) => {
  const body = parse(z.object({ identifier: z.string().trim().min(3), password: z.string().min(1).max(200) }), req.body);
  const phone = normalizePhone(body.identifier);
  const landlord = db()
    .prepare('SELECT * FROM landlords WHERE email = ? OR phone = ?')
    .get(body.identifier.toLowerCase(), phone ?? '');
  // Same error for unknown user and wrong password.
  if (!landlord || !(await verifyPassword(body.password, landlord.password_hash))) {
    throw unauthorized('Incorrect email/phone or password');
  }
  res.json({ token: await signAccessToken({ role: 'landlord', sub: landlord.id }), landlord: landlordDto(landlord) });
});

// ---- Password reset by SMS OTP (SM-SEC-001) ------------------------------

const resetKey = () => new TextEncoder().encode(`${config.jwtSecret}:password-reset`);

authRoutes.post('/password/forgot', otpLimiter, async (req, res) => {
  const { phone } = parse(z.object({ phone: phoneField }), req.body);
  const landlord = db().prepare('SELECT id FROM landlords WHERE phone = ?').get(phone);
  if (!landlord) throw notFound('Number not found');
  const code = issueOtp({ purpose: 'password_reset', subject: phone });
  await sendSms(phone, `Your smeter password reset code is ${code}. It expires in ${config.otp.ttlMinutes} minutes.`);
  res.json({ sentTo: maskPhone(phone), expiresInMinutes: config.otp.ttlMinutes, ...otpEcho(code) });
});

authRoutes.post('/password/verify', otpLimiter, async (req, res) => {
  const { phone, code } = parse(z.object({ phone: phoneField, code: z.string().trim() }), req.body);
  consumeOtp({ purpose: 'password_reset', subject: phone, code });
  const resetToken = await new SignJWT({ phone })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('10m')
    .sign(resetKey());
  res.json({ resetToken });
});

authRoutes.post('/password/reset', authLimiter, async (req, res) => {
  const body = parse(z.object({ resetToken: z.string().min(10), newPassword: password }), req.body);
  let phone;
  try {
    ({ payload: { phone } } = await jwtVerify(body.resetToken, resetKey(), { algorithms: ['HS256'] }));
  } catch {
    throw badRequest('This reset session has expired. Start again.');
  }
  const r = db()
    .prepare('UPDATE landlords SET password_hash = ? WHERE phone = ?')
    .run(await hashPassword(body.newPassword), phone);
  if (r.changes !== 1) throw notFound('Number not found');
  res.json({ ok: true });
});

// ---- Tenant: meter number → SMS OTP to the phone the landlord registered ---

authRoutes.post('/tenant/start', otpLimiter, async (req, res) => {
  const { meterId } = parse(z.object({ meterId: meterIdField }), req.body);
  const meter = db()
    .prepare("SELECT * FROM meters WHERE meter_id = ? AND status IN ('invited','active')")
    .get(meterId);
  if (!meter) {
    throw notFound("This meter number isn't registered on smeter yet. Ask your property owner to add it.");
  }
  const code = issueOtp({ purpose: 'tenant_login', subject: meterId });
  await sendSms(meter.tenant_phone, `Your smeter login code for meter ${meterId} is ${code}. It expires in ${config.otp.ttlMinutes} minutes.`);
  res.json({ sentTo: maskPhone(meter.tenant_phone), expiresInMinutes: config.otp.ttlMinutes, ...otpEcho(code) });
});

authRoutes.post('/tenant/verify', otpLimiter, async (req, res) => {
  const { meterId, code } = parse(z.object({ meterId: meterIdField, code: z.string().trim() }), req.body);
  consumeOtp({ purpose: 'tenant_login', subject: meterId, code });
  const meter = db()
    .prepare("SELECT * FROM meters WHERE meter_id = ? AND status IN ('invited','active')")
    .get(meterId);
  if (!meter) throw notFound('Meter not found');
  if (meter.status === 'invited') {
    // First successful login is the tenant accepting the meter link.
    db().prepare("UPDATE meters SET status = 'active', accepted_at = ? WHERE id = ?").run(now(), meter.id);
    notify({
      recipientType: 'landlord', recipientId: meter.landlord_id, kind: 'tenant_joined',
      title: 'Tenant connected',
      body: `The tenant on meter ${meterId}${meter.apartment ? ` (Apt ${meter.apartment})` : ''} accepted the link and can now buy power.`,
    });
  }
  const fresh = db().prepare('SELECT * FROM meters WHERE id = ?').get(meter.id);
  const landlord = db().prepare('SELECT * FROM landlords WHERE id = ?').get(fresh.landlord_id);
  res.json({ token: await signAccessToken({ role: 'tenant', sub: meterId }), tenant: tenantDto(fresh, landlord) });
});
