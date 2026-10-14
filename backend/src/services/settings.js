// Payment settings editable from the admin dashboard. The env vars
// (PAYMENT_CHANNELS, PAYMENT_FEE_*, MIN/MAX_PURCHASE_NAIRA,
// PAYMENT_AUDIT_AFTER_MINUTES) are the defaults; saved values override them.
// Read through a short per-instance cache so every quote doesn't hit the
// database, while edits reach all serverless instances within seconds.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.js';
import { db, now } from '../db.js';
import { badRequest } from '../util/errors.js';

export const PAYMENT_CHANNELS = [
  { id: 'card', label: 'Card' },
  { id: 'bank_transfer', label: 'Bank transfer' },
  { id: 'ussd', label: 'USSD' },
];
const CHANNEL_IDS = PAYMENT_CHANNELS.map((c) => c.id);
const CACHE_MS = 15_000;

/** Defaults from env, in naira (the units the admin edits). */
function envDefaults() {
  const p = config.payments;
  return {
    channels: p.channels.filter((c) => CHANNEL_IDS.includes(c)),
    feePercent: p.feePercent,
    feeFlatNaira: p.feeFlatKobo / 100,
    feeFlatThresholdNaira: p.feeFlatThresholdKobo / 100,
    feeCapNaira: p.feeCapKobo / 100,
    minPurchaseNaira: p.minPurchaseKobo / 100,
    maxPurchaseNaira: p.maxPurchaseKobo / 100,
    auditAfterMinutes: p.auditAfterMinutes,
  };
}

const money = (label, max) => z.coerce.number({ error: `${label} must be a number` }).min(0, `${label} can't be negative`).max(max, `${label} is too high`);

export const paymentSettingsSchema = z
  .object({
    channels: z.array(z.enum(CHANNEL_IDS)).min(1, 'Choose at least one payment channel').transform((c) => [...new Set(c)]),
    feePercent: z.coerce.number().min(0, 'Fee percent can’t be negative').max(10, 'Fee percent can be at most 10%'),
    feeFlatNaira: money('Flat fee', 10_000),
    feeFlatThresholdNaira: money('Flat fee threshold', 10_000_000),
    feeCapNaira: money('Fee cap', 100_000),
    minPurchaseNaira: z.coerce.number().min(100, 'Minimum purchase must be at least ₦100').max(1_000_000),
    maxPurchaseNaira: z.coerce.number().min(100).max(10_000_000, 'Maximum purchase can be at most ₦10,000,000'),
    auditAfterMinutes: z.coerce.number().int('Use whole minutes').min(1, 'At least 1 minute').max(1440, 'At most 24 hours'),
  })
  .refine((s) => s.minPurchaseNaira < s.maxPurchaseNaira, { message: 'Minimum purchase must be below the maximum', path: ['minPurchaseNaira'] });

let cache = null;

/** Effective settings (naira) plus who changed them last. */
export async function getPaymentSettings({ fresh = false } = {}) {
  if (!fresh && cache && cache.expires > Date.now()) return cache.value;
  const row = await db().get(
    `SELECT s.data, s.updated_at, st.name AS by_name FROM settings s
     LEFT JOIN staff st ON st.id = s.updated_by WHERE s.key = 'payments'`,
  );
  const saved = row ? JSON.parse(row.data) : {};
  const merged = { ...envDefaults(), ...saved };
  // Anything stored that no longer validates (e.g. a removed channel) falls back to the defaults.
  const parsed = paymentSettingsSchema.safeParse(merged);
  const value = {
    ...(parsed.success ? parsed.data : envDefaults()),
    updatedAt: row?.updated_at ?? null,
    updatedBy: row?.by_name ?? null,
  };
  cache = { value, expires: Date.now() + CACHE_MS };
  return value;
}

/** The kobo-based shape pricing and checkout use (same keys as config.payments). */
export async function paymentParams() {
  const s = await getPaymentSettings();
  return {
    ...config.payments,
    channels: s.channels,
    feePercent: s.feePercent,
    feeFlatKobo: Math.round(s.feeFlatNaira * 100),
    feeFlatThresholdKobo: Math.round(s.feeFlatThresholdNaira * 100),
    feeCapKobo: Math.round(s.feeCapNaira * 100),
    minPurchaseKobo: Math.round(s.minPurchaseNaira * 100),
    maxPurchaseKobo: Math.round(s.maxPurchaseNaira * 100),
    auditAfterMinutes: s.auditAfterMinutes,
  };
}

export async function savePaymentSettings(input, staffId) {
  const parsed = paymentSettingsSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw badRequest(issue.message, { [issue.path.join('.') || 'settings']: issue.message });
  }
  await db().run(
    `INSERT INTO settings (key, data, updated_by, updated_at) VALUES ('payments', ?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET data = excluded.data, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    JSON.stringify(parsed.data), staffId, now(),
  );
  cache = null;
  return getPaymentSettings({ fresh: true });
}

/** Restore the env defaults. */
export async function resetPaymentSettings() {
  await db().run("DELETE FROM settings WHERE key = 'payments'");
  cache = null;
  return getPaymentSettings({ fresh: true });
}

/** What the app needs to build its Buy Power screen. */
export async function publicPaymentOptions() {
  const s = await getPaymentSettings();
  return { channels: s.channels, minPurchase: s.minPurchaseNaira, maxPurchase: s.maxPurchaseNaira };
}

export const paymentSettingsDefaults = envDefaults;

// ---- Unit price limits ---------------------------------------------------------
// MAX_UNIT_PRICE_NAIRA / BASE_UNIT_COST_NAIRA are the defaults. Owners set their
// own price per kWh between the utility cost (floor) and the regulated cap.

const tariffDefaults = () => ({
  maxUnitPriceNaira: config.tariff.maxUnitPriceNaira,
  baseUnitCostNaira: config.tariff.baseUnitCostNaira,
});

export const tariffSettingsSchema = z
  .object({
    maxUnitPriceNaira: z.coerce.number({ error: 'Enter the maximum price' }).positive('The maximum must be above ₦0').max(100_000, 'The maximum is too high'),
    baseUnitCostNaira: z.coerce.number({ error: 'Enter the utility cost' }).positive('The utility cost must be above ₦0').max(100_000, 'The utility cost is too high'),
  })
  .refine((s) => s.baseUnitCostNaira < s.maxUnitPriceNaira, {
    message: 'The utility cost must be below the maximum price, or owners can’t set any price',
    path: ['baseUnitCostNaira'],
  });

let tariffCache = null;
// Last loaded values, for synchronous readers (e.g. DTOs). Refreshed by
// getTariffSettings(), which every /v1 request triggers through the cache.
let tariffSnapshot = null;

export async function getTariffSettings({ fresh = false } = {}) {
  if (!fresh && tariffCache && tariffCache.expires > Date.now()) return tariffCache.value;
  const row = await db().get(
    `SELECT s.data, s.updated_at, st.name AS by_name FROM settings s
     LEFT JOIN staff st ON st.id = s.updated_by WHERE s.key = 'tariff'`,
  );
  const parsed = tariffSettingsSchema.safeParse({ ...tariffDefaults(), ...(row ? JSON.parse(row.data) : {}) });
  const value = {
    ...(parsed.success ? parsed.data : tariffDefaults()),
    updatedAt: row?.updated_at ?? null,
    updatedBy: row?.by_name ?? null,
  };
  tariffCache = { value, expires: Date.now() + CACHE_MS };
  tariffSnapshot = value;
  return value;
}

/** Synchronous best-known values (env defaults until first load). */
export function tariffNow() {
  return tariffSnapshot ?? tariffDefaults();
}

export async function saveTariffSettings(input, staffId) {
  const parsed = tariffSettingsSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw badRequest(issue.message, { [issue.path.join('.') || 'settings']: issue.message });
  }
  await db().run(
    `INSERT INTO settings (key, data, updated_by, updated_at) VALUES ('tariff', ?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET data = excluded.data, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    JSON.stringify(parsed.data), staffId, now(),
  );
  tariffCache = null;
  return getTariffSettings({ fresh: true });
}

export async function resetTariffSettings() {
  await db().run("DELETE FROM settings WHERE key = 'tariff'");
  tariffCache = null;
  return getTariffSettings({ fresh: true });
}

/** Owners whose current price falls outside the limits (shown as a warning in the admin). */
export async function tariffImpact(s) {
  const max = Math.round(s.maxUnitPriceNaira * 100);
  const base = Math.round(s.baseUnitCostNaira * 100);
  const row = await db().get(
    `SELECT COUNT(*) FILTER (WHERE unit_price_kobo > ?) AS above_max,
            COUNT(*) FILTER (WHERE unit_price_kobo > 0 AND unit_price_kobo < ?) AS below_cost,
            COUNT(*) FILTER (WHERE unit_price_kobo > 0) AS priced
     FROM landlords`,
    max, base,
  );
  return { aboveMax: row.above_max, belowCost: row.below_cost, priced: row.priced };
}

export const tariffSettingsDefaults = tariffDefaults;

// ---- Meter head-end (Geni / Calin) connection --------------------------------------
// GENI_* env vars are the defaults. Passwords are stored encrypted (AES-256-GCM,
// key derived from JWT_SECRET) and are never sent back to the dashboard.

const GENI_SECRET_FIELDS = ['password', 'authorizationPassword'];

function secretKey() {
  return createHash('sha256').update(`${config.jwtSecret}:settings-secrets`).digest();
}
function seal(plain) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secretKey(), iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${data.toString('base64')}`;
}
function unseal(sealed) {
  try {
    const [v, iv, tag, data] = String(sealed).split(':');
    if (v !== 'v1') return '';
    const d = createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
  } catch {
    return ''; // e.g. JWT_SECRET changed: treat as not set
  }
}

const geniEnvDefaults = () => ({
  mode: config.geni.mode,
  baseUrl: config.geni.baseUrl,
  company: config.geni.company,
  tariffPrefix: config.geni.tariffPrefix,
  userId: config.geni.userId,
  password: config.geni.password,
  authorizationPassword: config.geni.authorizationPassword,
});

/** Prefix of owner tariff ids on the head-end; short so the id stays well inside its length limit. */
const TARIFF_PREFIX = z.string().trim().regex(/^[A-Za-z0-9]{1,8}$/, 'Tariff prefix must be 1–8 letters or digits').transform((p) => p.toUpperCase());

export const geniSettingsSchema = z.object({
  mode: z.enum(['live', 'mock']),
  baseUrl: z.string().trim().url('Enter the head-end address, e.g. http://8.208.24.83:9200').max(200).transform((u) => u.replace(/\/+$/, '')),
  company: z.string().trim().min(1, 'Enter the company').max(80),
  tariffPrefix: TARIFF_PREFIX.optional(),
  userId: z.string().trim().max(80),
  password: z.string().max(200).optional(),
  authorizationPassword: z.string().max(200).optional(),
});

let geniCache = null;

/** Effective head-end settings, secrets included (server-side use only). */
export async function getGeniSettings({ fresh = false } = {}) {
  if (!fresh && geniCache && geniCache.expires > Date.now()) return geniCache.value;
  const row = await db().get(
    `SELECT s.data, s.updated_at, st.name AS by_name FROM settings s
     LEFT JOIN staff st ON st.id = s.updated_by WHERE s.key = 'geni'`,
  );
  const saved = row ? JSON.parse(row.data) : {};
  for (const f of GENI_SECRET_FIELDS) if (saved[f] !== undefined) saved[f] = unseal(saved[f]);
  const value = { ...geniEnvDefaults(), ...saved, updatedAt: row?.updated_at ?? null, updatedBy: row?.by_name ?? null };
  if (value.mode === 'live' && !(value.userId && value.password)) value.mode = 'mock';
  geniCache = { value, expires: Date.now() + CACHE_MS };
  return value;
}

/** Dashboard view: secrets replaced by whether they are set. */
export function publicGeniSettings(s) {
  const { password, authorizationPassword, ...rest } = s;
  return { ...rest, passwordSet: Boolean(password), authorizationPasswordSet: Boolean(authorizationPassword) };
}

/** Merge a dashboard edit over the current values; blank secrets keep the stored ones. */
export async function mergeGeniInput(input) {
  const parsed = geniSettingsSchema.safeParse(input ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw badRequest(issue.message, { [issue.path.join('.') || 'settings']: issue.message });
  }
  const current = await getGeniSettings({ fresh: true });
  const next = { ...parsed.data };
  for (const f of GENI_SECRET_FIELDS) if (!next[f]) next[f] = current[f];
  next.tariffPrefix ??= current.tariffPrefix;
  if (next.mode === 'live' && !(next.userId && next.password)) {
    throw badRequest('Enter the head-end username and password to use the real head-end');
  }
  return next;
}

export async function saveGeniSettings(input, staffId) {
  const next = await mergeGeniInput(input);
  const stored = { ...next };
  for (const f of GENI_SECRET_FIELDS) stored[f] = next[f] ? seal(next[f]) : '';
  await db().run(
    `INSERT INTO settings (key, data, updated_by, updated_at) VALUES ('geni', ?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET data = excluded.data, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    JSON.stringify(stored), staffId, now(),
  );
  geniCache = null;
  return getGeniSettings({ fresh: true });
}

export async function resetGeniSettings() {
  await db().run("DELETE FROM settings WHERE key = 'geni'");
  geniCache = null;
  return getGeniSettings({ fresh: true });
}

export const geniSettingsDefaults = () => publicGeniSettings(geniEnvDefaults());
