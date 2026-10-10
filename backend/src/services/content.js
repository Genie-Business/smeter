// Website / app copy managed from the admin dashboard.
//
// Saved documents are sanitised against the code defaults: only keys that exist
// in the defaults survive, scalar types must match, strings are length-capped,
// and image fields must be site-relative or http(s). Readers get the defaults
// deep-merged with the saved overrides, so new default fields appear
// automatically after a deploy.
import { db, now, tx } from '../db.js';
import { CONTENT_DEFAULTS } from '../content/defaults.js';
import { badRequest, notFound } from '../util/errors.js';

export const CONTENT_KEYS = Object.keys(CONTENT_DEFAULTS);
const MAX_STRING = 5000;
const MAX_ARRAY = 40;
const IMAGE_URL = /^(https:\/\/|http:\/\/localhost|\/uploads\/|assets\/)/;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function sanitize(template, value, path, isImage) {
  if (Array.isArray(template)) {
    if (!Array.isArray(value)) throw badRequest(`${path} must be a list`);
    if (value.length > MAX_ARRAY) throw badRequest(`${path} can have at most ${MAX_ARRAY} items`);
    const shape = template[0];
    return value.map((item, i) => (shape === undefined ? item : sanitize(shape, item, `${path}[${i}]`, isImage)));
  }
  if (isPlainObject(template)) {
    if (!isPlainObject(value)) throw badRequest(`${path} must be an object`);
    const out = {};
    for (const key of Object.keys(template)) {
      if (value[key] === undefined) continue;
      out[key] = sanitize(template[key], value[key], path ? `${path}.${key}` : key, isImage || key === 'images');
    }
    return out;
  }
  if (typeof template === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n)) throw badRequest(`${path} must be a number`);
    return n;
  }
  if (typeof template === 'boolean') return value === true || value === 'true';
  // string
  if (typeof value !== 'string') throw badRequest(`${path} must be text`);
  if (value.length > MAX_STRING) throw badRequest(`${path} is too long`);
  if (isImage && value && !IMAGE_URL.test(value)) {
    throw badRequest(`${path} must be an uploaded image, a site asset path or an https URL`);
  }
  return value;
}

/** Deep merge: objects merge key by key; arrays and scalars from `over` win. */
export function deepMerge(base, over) {
  if (over === undefined) return base;
  if (isPlainObject(base) && isPlainObject(over)) {
    const out = { ...base };
    for (const [k, v] of Object.entries(over)) out[k] = deepMerge(base[k], v);
    return out;
  }
  return over;
}

function assertKey(key) {
  if (!CONTENT_KEYS.includes(key)) throw notFound('Unknown content');
}

export async function getContent(key) {
  assertKey(key);
  const row = await db().get('SELECT data, version, updated_at FROM content WHERE key = ?', key);
  const overrides = row ? JSON.parse(row.data) : {};
  return {
    data: deepMerge(CONTENT_DEFAULTS[key], overrides),
    version: row?.version ?? 0,
    updatedAt: row?.updated_at ?? null,
  };
}

const conflictError = () =>
  Object.assign(badRequest('Someone else saved this content since you opened it. Reload to see their changes.'), {
    status: 409,
    code: 'conflict',
  });

/**
 * Save a full document. `expectedVersion` guards against two editors
 * overwriting each other.
 */
export async function saveContent(key, data, staffId, expectedVersion) {
  assertKey(key);
  const clean = sanitize(CONTENT_DEFAULTS[key], data, '', false);
  const json = JSON.stringify(clean);
  if (json.length > 256 * 1024) throw badRequest('Content is too large');
  await tx(async () => {
    // Lock the row (if any) so concurrent saves serialise.
    const current = await db().get('SELECT version FROM content WHERE key = ? FOR UPDATE', key);
    const version = current?.version ?? 0;
    if (expectedVersion !== undefined && expectedVersion !== version) throw conflictError();
    const next = version + 1;
    const saved = await db().run(
      `INSERT INTO content (key, data, version, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (key) DO UPDATE SET data = excluded.data, version = excluded.version,
         updated_by = excluded.updated_by, updated_at = excluded.updated_at
       WHERE content.version = ?`,
      key, json, next, staffId, now(), version,
    );
    if (saved.changes !== 1) throw conflictError();
    await db().run('INSERT INTO content_history (key, version, data, updated_by) VALUES (?, ?, ?, ?)', key, next, json, staffId);
  });
  return getContent(key);
}

export async function contentHistory(key, limit = 20) {
  assertKey(key);
  const rows = await db().all(
    `SELECT h.version, h.created_at, s.name AS by_name FROM content_history h
     LEFT JOIN staff s ON s.id = h.updated_by WHERE h.key = ? ORDER BY h.version DESC LIMIT ?`,
    key, limit,
  );
  return rows.map((r) => ({ version: r.version, savedAt: r.created_at, by: r.by_name }));
}

/** Restore an old version by saving it again as the newest version. */
export async function restoreContent(key, version, staffId) {
  assertKey(key);
  const row = await db().get('SELECT data FROM content_history WHERE key = ? AND version = ?', key, version);
  if (!row) throw notFound('That version no longer exists');
  return saveContent(key, JSON.parse(row.data), staffId);
}

export function resetContent(key, staffId) {
  return saveContent(key, {}, staffId);
}
