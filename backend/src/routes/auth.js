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

// ---- Password reset by SMS OTP (SM-SEC-001) ------------------------------

const resetKey = () => new TextEncoder().encode(`${config.jwtSecret}:password-reset`);

authRoutes.post('/password/forgot', otpLimiter, async (req, res) => {
  const { phone } = parse(z.object({ phone: phoneField }), req.body);
  const landlord = await db().get('SELECT id FROM landlords WHERE phone = ?', phone);
  if (!landlord) throw notFound('Number not found');
  const code = await issueOtp({ purpose: 'password_reset', subject: phone });
  await sendSms(phone, `Your smeter password reset code is ${code}. It expires in ${config.otp.ttlMinutes} minutes.`);
  res.json({ sentTo: maskPhone(phone), expiresInMinutes: config.otp.ttlMinutes, ...otpEcho(code) });
});

authRoutes.post('/password/verify', otpLimiter, async (req, res) => {
  const { phone, code } = parse(z.object({ phone: phoneField, code: z.string().trim() }), req.body);
  await consumeOtp({ purpose: 'password_reset', subject: phone, code });
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
  const r = await db().run('UPDATE landlords SET password_hash = ? WHERE phone = ?', await hashPassword(body.newPassword), phone);
  if (r.changes !== 1) throw notFound('Number not found');
  res.json({ ok: true });
});

// ---- Tenant: meter number → SMS OTP to the phone the landlord registered ---

const linkedMeter = (meterId) =>
  db().get("SELECT * FROM meters WHERE meter_id = ? AND status IN ('invited','active')", meterId);

authRoutes.post('/tenant/start', otpLimiter, async (req, res) => {
  const { meterId } = parse(z.object({ meterId: meterIdField }), req.body);
  const meter = await linkedMeter(meterId);
  if (!meter) {
    throw notFound("This meter number isn't registered on smeter yet. Ask your property owner to add it.");
  }
  const code = await issueOtp({ purpose: 'tenant_login', subject: meterId });
  await sendSms(meter.tenant_phone, `Your smeter login code for meter ${meterId} is ${code}. It expires in ${config.otp.ttlMinutes} minutes.`);
  res.json({ sentTo: maskPhone(meter.tenant_phone), expiresInMinutes: config.otp.ttlMinutes, ...otpEcho(code) });
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
