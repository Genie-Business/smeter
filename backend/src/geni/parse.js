// Load-profile and instantaneous-value rows come back as a `headline` (column
// labels) plus a `data` string of values. The exact delimiter isn't documented,
// so parse defensively: JSON first, then common separators.

function splitCells(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map(String);
  const s = String(value).trim();
  if (s.startsWith('[') || s.startsWith('{')) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.map(String);
      if (parsed && typeof parsed === 'object') return Object.entries(parsed).map(([k, v]) => `${k}=${v}`);
    } catch {
      /* fall through */
    }
  }
  for (const sep of ['|', ';', ',', '\t']) {
    if (s.includes(sep)) return s.split(sep).map((c) => c.trim());
  }
  return [s];
}

// The separator used by the column labels; the values use the same one. The
// real head-end sends e.g. headline "Meter status,Phase-A Voltage,..." with
// data "Relay Status; Terminal cover open; ,0.0,229.7,...": the status text
// has semicolons of its own, so the data must not be split on those.
function separatorOf(headline) {
  const s = String(headline ?? '').trim();
  if (s.startsWith('[') || s.startsWith('{')) return undefined; // JSON: handled by splitCells
  return [',', '|', '\t', ';'].find((sep) => s.includes(sep));
}

/**
 * Turn one upstream row into { at: Date, values: { label: number }, texts: { label: string } }.
 * Non-numeric cells (like the meter status) go to `texts`.
 */
export function parseCurveRow(row) {
  const sep = separatorOf(row.headline);
  const labels = sep ? String(row.headline).split(sep).map((c) => c.trim()) : splitCells(row.headline);
  const cells = sep && typeof row.data === 'string' && !/^\s*[[{]/.test(row.data)
    ? row.data.split(sep).map((c) => c.trim())
    : splitCells(row.data);
  const values = {};
  const texts = {};
  cells.forEach((cell, i) => {
    let label = labels[i] ?? `col${i}`;
    let raw = cell;
    const kv = cell.match(/^([^=:]+)[=:](.*)$/);
    if (kv && !/^-?\d/.test(cell)) {
      label = kv[1].trim();
      raw = kv[2];
    }
    const str = String(raw).trim();
    if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*[a-zA-Z%]*$/.test(str)) {
      values[label.trim()] = Number.parseFloat(str);
    } else if (str) {
      texts[label.trim()] = str;
    }
  });
  return { at: headEndTime(row.currentDate ?? row.createDate), values, texts };
}

// Zone of the head-end's timestamps ("2026-11-19 11:51:11" carries none). They
// are West Africa Time: a token minted at 10:51 UTC is recorded as 11:51.
const HEAD_END_UTC_OFFSET = process.env.GENI_TIME_OFFSET || '+01:00';

/** Read a head-end timestamp, which has no zone, as West Africa Time. */
export function headEndTime(value) {
  const s = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) return new Date(`${s.replace(' ', 'T')}${HEAD_END_UTC_OFFSET}`);
  return new Date(s);
}

/** Alarm/status flags from the meter-status cell, e.g. ['Relay Status', 'Terminal cover open']. */
export function statusFlags(texts = {}) {
  const key = Object.keys(texts).find((k) => /status/i.test(k)) ?? Object.keys(texts)[0];
  if (key === undefined) return [];
  return texts[key].split(';').map((f) => f.trim()).filter(Boolean);
}

const isNeutral = (k) => /phase-?\s*n(\s|$)|neutral/i.test(k);
const isActivePower = (k) => /active\s*power/i.test(k) && !/reverse|reactive|export/i.test(k);

/**
 * Live "virtual display" figures from one instantaneous row. Three-phase meters
 * report each phase: voltage is the highest live phase, current and power are
 * summed. Power is in W unless the label says kW (powerUnit overrides that guess).
 */
export function liveFigures(values, { powerUnit = 'W' } = {}) {
  const keys = Object.keys(values);
  const volts = keys.filter((k) => /volt/i.test(k)).map((k) => values[k]);
  const amps = keys.filter((k) => /current/i.test(k) && !isNeutral(k)).map((k) => values[k]);
  const power = keys.filter(isActivePower);
  const kw = power.length
    ? power.reduce((sum, k) => sum + values[k] / (/kw/i.test(k) || powerUnit === 'kW' ? 1 : 1000), 0)
    : null;
  const balance = balanceColumn(values);
  const round = (n, dp) => (n == null ? null : Math.round(n * 10 ** dp) / 10 ** dp);
  return {
    volts: volts.length ? round(Math.max(...volts), 1) : null,
    amps: amps.length ? round(amps.reduce((a, b) => a + b, 0), 3) : null,
    kw: round(kw, 3),
    meterBalanceKwh: balance === undefined ? null : values[balance],
  };
}

const ENERGY_PATTERNS = [
  /(total|forward|import|positive).*active.*energy/i,
  /active.*energy.*(total|forward|import|\+)/i,
  /^\+?a\s*\(?kwh/i,
  /kwh/i,
  /energy/i,
];

export function pickColumn(values, patterns) {
  const keys = Object.keys(values);
  for (const p of patterns) {
    const k = keys.find((key) => p.test(key));
    if (k !== undefined) return k;
  }
  return undefined;
}

/**
 * Energy columns of a dual-source meter: source B is the column matching
 * `sourceBPattern`; source A is the usual energy column among the rest.
 */
export function energyColumns(values, sourceBPattern) {
  let b;
  try {
    const re = new RegExp(sourceBPattern, 'i');
    b = Object.keys(values).find((k) => re.test(k));
  } catch {
    b = undefined;
  }
  const rest = Object.fromEntries(Object.entries(values).filter(([k]) => k !== b));
  return { a: energyColumn(rest), b };
}

export const energyColumn = (values) => pickColumn(values, ENERGY_PATTERNS) ?? Object.keys(values)[0];
export const voltageColumn = (values) => pickColumn(values, [/volt/i, /^u[a-c]?\b/i]);
export const currentColumn = (values) => pickColumn(values, [/current/i, /amp/i, /^i[a-c]?\b/i]);
export const powerColumn = (values) => pickColumn(values, [/active.*power/i, /power/i, /\bkw\b/i]);
export const balanceColumn = (values) => pickColumn(values, [/balance/i, /credit/i, /remain/i]);

/**
 * Consumption per bucket from energy readings.
 * mode 'cumulative': readings are register totals → attribute positive deltas
 * between consecutive readings to the bucket of the later reading.
 * mode 'interval': each reading is already the energy for its interval.
 */
export function bucketConsumption(readings, bucketOf, mode = 'cumulative') {
  const sorted = readings
    .filter((r) => Number.isFinite(r.kwh) && !Number.isNaN(r.at.getTime()))
    .sort((a, b) => a.at - b.at);
  const totals = new Map();
  const add = (key, kwh) => totals.set(key, (totals.get(key) ?? 0) + kwh);
  if (mode === 'interval') {
    for (const r of sorted) {
      const key = bucketOf(r.at);
      if (key !== undefined) add(key, Math.max(0, r.kwh));
    }
    return totals;
  }
  for (let i = 1; i < sorted.length; i++) {
    const delta = sorted[i].kwh - sorted[i - 1].kwh;
    if (delta < 0 || delta > 1000) continue; // register reset / bad read
    const key = bucketOf(sorted[i].at);
    if (key !== undefined) add(key, delta);
  }
  return totals;
}
