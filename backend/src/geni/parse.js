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

/** Turn one upstream row into { at: Date, values: { label: number } }. */
export function parseCurveRow(row) {
  const labels = splitCells(row.headline);
  const cells = splitCells(row.data);
  const values = {};
  cells.forEach((cell, i) => {
    let label = labels[i] ?? `col${i}`;
    let raw = cell;
    const kv = cell.match(/^([^=:]+)[=:](.*)$/);
    if (kv && !/^-?\d/.test(cell)) {
      label = kv[1].trim();
      raw = kv[2];
    }
    const n = Number.parseFloat(String(raw).replace(/[^\d.eE+-]/g, ''));
    if (Number.isFinite(n)) values[label.trim()] = n;
  });
  return { at: new Date(row.currentDate ?? row.createDate), values };
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
