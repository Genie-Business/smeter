// SQLite persistence via Node's built-in driver (no native deps). Money is
// stored as integer kobo; timestamps as ISO-8601 strings.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS landlords (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name           TEXT NOT NULL,
  email               TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone               TEXT NOT NULL UNIQUE,
  password_hash       TEXT NOT NULL,
  address             TEXT,
  bank_name           TEXT,
  bank_code           TEXT,
  account_number      TEXT,
  account_name        TEXT,
  bank_verified_at    TEXT,
  settlement_ref      TEXT,             -- payment provider subaccount code
  unit_price_kobo     INTEGER NOT NULL DEFAULT 0,  -- price per kWh
  fee_bearer          TEXT NOT NULL DEFAULT 'tenant' CHECK (fee_bearer IN ('tenant','landlord')),
  tariff_id           TEXT,             -- Geni tariff carrying unit_price
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS meters (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  meter_id              TEXT NOT NULL UNIQUE,      -- serial number on the hardware
  landlord_id           INTEGER NOT NULL REFERENCES landlords(id),
  address               TEXT NOT NULL,
  apartment             TEXT,
  tenant_first_name     TEXT,
  tenant_last_name      TEXT,
  tenant_email          TEXT,
  tenant_phone          TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','removed')),
  accepted_at           TEXT,
  is_three_phase        INTEGER NOT NULL DEFAULT 0,
  customer_id           TEXT,                      -- Geni customer id
  debt_kobo             INTEGER NOT NULL DEFAULT 0,
  debt_recovery_percent REAL NOT NULL DEFAULT 0,
  relay_state           TEXT NOT NULL DEFAULT 'connected' CHECK (relay_state IN ('connected','disconnect_pending','disconnected','reconnect_pending')),
  -- 'ota': tokens are pushed over GPRS; 'manual': tenant keys tokens into the meter remote
  delivery_mode         TEXT NOT NULL DEFAULT 'ota' CHECK (delivery_mode IN ('ota','manual')),
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS meters_landlord ON meters(landlord_id);

CREATE TABLE IF NOT EXISTS purchases (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  reference          TEXT NOT NULL UNIQUE,         -- unique per payment attempt
  meter_id           TEXT NOT NULL,
  landlord_id        INTEGER NOT NULL,
  initiated_by       TEXT NOT NULL CHECK (initiated_by IN ('tenant','landlord')),
  amount_kobo        INTEGER NOT NULL,             -- value the buyer chose
  debt_kobo          INTEGER NOT NULL DEFAULT 0,   -- debt recovered from amount
  energy_kobo        INTEGER NOT NULL,             -- amount - debt, vended as units
  fee_kobo           INTEGER NOT NULL DEFAULT 0,
  fee_bearer         TEXT NOT NULL,
  total_kobo         INTEGER NOT NULL,             -- what the payer is charged
  landlord_net_kobo  INTEGER NOT NULL,
  unit_price_kobo    INTEGER NOT NULL,
  base_cost_kobo     INTEGER NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','paid','vending','vended','failed','abandoned')),
  units              REAL,
  token              TEXT,
  receipt_id         TEXT,
  delivery           TEXT CHECK (delivery IN ('ota_queued','ota_delivered','manual')),
  delivery_task_id   TEXT,
  failure_reason     TEXT,
  provider           TEXT NOT NULL,
  authorization_url  TEXT,
  paid_at            TEXT,
  vended_at          TEXT,
  audited_at         TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS purchases_meter ON purchases(meter_id, created_at);
CREATE INDEX IF NOT EXISTS purchases_landlord ON purchases(landlord_id, created_at);
CREATE INDEX IF NOT EXISTS purchases_status ON purchases(status, created_at);

CREATE TABLE IF NOT EXISTS otps (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  purpose      TEXT NOT NULL,      -- tenant_login | password_reset | bank_update
  subject      TEXT NOT NULL,      -- meter id / phone / landlord id
  code_hash    TEXT NOT NULL,
  payload      TEXT,               -- JSON stashed until the OTP is confirmed
  attempts     INTEGER NOT NULL DEFAULT 0,
  expires_at   TEXT NOT NULL,
  consumed_at  TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS otps_lookup ON otps(purpose, subject, created_at);

CREATE TABLE IF NOT EXISTS notifications (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_type  TEXT NOT NULL CHECK (recipient_type IN ('landlord','tenant')),
  recipient_id    TEXT NOT NULL,    -- landlord id or meter id
  kind            TEXT NOT NULL,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  read_at         TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS notifications_recipient ON notifications(recipient_type, recipient_id, created_at);

CREATE TABLE IF NOT EXISTS support_tickets (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_ref      TEXT NOT NULL UNIQUE,
  reporter_type   TEXT NOT NULL CHECK (reporter_type IN ('landlord','tenant')),
  reporter_id     TEXT NOT NULL,
  meter_id        TEXT NOT NULL,
  category        TEXT NOT NULL,
  department      TEXT NOT NULL CHECK (department IN ('finance','technical')),
  description     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id           TEXT PRIMARY KEY,    -- provider event/transaction id (idempotency)
  provider     TEXT NOT NULL,
  event        TEXT NOT NULL,
  received_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- smeter team accounts for the admin dashboard (not landlords).
CREATE TABLE IF NOT EXISTS staff (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name           TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('owner','editor')),
  last_login_at  TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Editable website / app copy: overrides deep-merged over code defaults.
CREATE TABLE IF NOT EXISTS content (
  key         TEXT PRIMARY KEY,          -- 'site' | 'app'
  data        TEXT NOT NULL,             -- JSON overrides
  version     INTEGER NOT NULL DEFAULT 1,
  updated_by  INTEGER,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS content_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT NOT NULL,
  version     INTEGER NOT NULL,
  data        TEXT NOT NULL,
  updated_by  INTEGER,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Property-owner onboarding requests from the website.
CREATE TABLE IF NOT EXISTS owner_leads (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name      TEXT NOT NULL,
  phone          TEXT NOT NULL,
  email          TEXT,
  city           TEXT,
  property_type  TEXT,
  units          INTEGER,
  message        TEXT,
  status         TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','surveyed','onboarded','closed')),
  note           TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- "Tell me when the app is out" sign-ups.
CREATE TABLE IF NOT EXISTS notify_requests (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  contact     TEXT NOT NULL,
  platform    TEXT NOT NULL CHECK (platform IN ('android','ios','any')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (contact, platform)
);
`;

let instance;

export function openDb(path = config.databasePath) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

// Additive column migrations for databases created by earlier versions.
function migrate(d) {
  const cols = new Set(d.prepare('PRAGMA table_info(meters)').all().map((c) => c.name));
  if (!cols.has('delivery_mode')) {
    d.exec("ALTER TABLE meters ADD COLUMN delivery_mode TEXT NOT NULL DEFAULT 'ota' CHECK (delivery_mode IN ('ota','manual'))");
  }
}

export function db() {
  if (!instance) instance = openDb();
  return instance;
}

// Tests swap in an in-memory database.
export function setDb(next) {
  instance = next;
}

export function now() {
  return new Date().toISOString();
}

export function tx(fn) {
  const d = db();
  d.exec('BEGIN IMMEDIATE');
  try {
    const out = fn(d);
    d.exec('COMMIT');
    return out;
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  }
}
