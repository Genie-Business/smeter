// Usage analytics, the tenant's remaining-units estimate and the live "virtual
// display", all derived from the head-end's load-profile curves.
import { config } from '../config.js';
import { db } from '../db.js';
import { geni } from '../geni/index.js';
import {
  bucketConsumption, currentColumn, energyColumn, parseCurveRow, powerColumn, voltageColumn, balanceColumn,
} from '../geni/parse.js';
import { koboToNaira } from '../util/http.js';

const DAY = 24 * 60 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const round = (n, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

// Periods are computed in West Africa Time (UTC+1, no DST).
const TZ_OFFSET = 60 * 60 * 1000;
const local = (d) => new Date(d.getTime() + TZ_OFFSET);
const fromLocal = (y, m, day = 1, h = 0) => new Date(Date.UTC(y, m, day, h) - TZ_OFFSET);

/** Buckets for a period containing `anchor`. Returns {start, end, buckets[], bucketOf}. */
export function periodWindow(period, anchor) {
  const a = local(anchor);
  const y = a.getUTCFullYear();
  const m = a.getUTCMonth();
  const d = a.getUTCDate();
  if (period === 'day') {
    const start = fromLocal(y, m, d);
    const buckets = Array.from({ length: 24 }, (_, h) => ({ key: h, label: String(h).padStart(2, '0') }));
    return {
      start, end: new Date(start.getTime() + DAY), buckets,
      bucketOf: (t) => local(t).getUTCHours(),
      label: `${d} ${MONTHS[m]}, ${y}`,
      previous: new Date(start.getTime() - DAY / 2),
    };
  }
  if (period === 'week') {
    const dow = (a.getUTCDay() + 6) % 7; // Monday = 0
    const start = fromLocal(y, m, d - dow);
    const buckets = WEEKDAYS.map((label, i) => ({ key: i, label }));
    return {
      start, end: new Date(start.getTime() + 7 * DAY), buckets,
      bucketOf: (t) => Math.floor((t - start) / DAY),
      label: `Week of ${local(start).getUTCDate()} ${MONTHS[local(start).getUTCMonth()]}`,
      previous: new Date(start.getTime() - DAY),
    };
  }
  if (period === 'year') {
    const start = fromLocal(y, 0, 1);
    return {
      start, end: fromLocal(y + 1, 0, 1),
      buckets: MONTHS.map((label, i) => ({ key: i, label })),
      bucketOf: (t) => (local(t).getUTCFullYear() === y ? local(t).getUTCMonth() : undefined),
      label: String(y),
      previous: new Date(start.getTime() - DAY),
    };
  }
  // month
  const start = fromLocal(y, m, 1);
  const end = fromLocal(y, m + 1, 1);
  const days = Math.round((end - start) / DAY);
  return {
    start, end,
    buckets: Array.from({ length: days }, (_, i) => ({ key: i + 1, label: String(i + 1) })),
    bucketOf: (t) => {
      const l = local(t);
      return l.getUTCMonth() === m && l.getUTCFullYear() === y ? l.getUTCDate() : undefined;
    },
    label: `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m]}, ${y}`,
    previous: new Date(start.getTime() - DAY),
  };
}

async function readings(meter, from, to) {
  const rows = await geni().loadProfile({
    meterId: meter.meter_id,
    isThreePhase: Boolean(meter.is_three_phase),
    from,
    to,
  });
  return rows.map(parseCurveRow).map((r) => {
    const col = energyColumn(r.values);
    return { at: r.at, kwh: col === undefined ? NaN : r.values[col] };
  });
}

function summarise(win, totals, nowTs) {
  // Buckets that haven't started yet are null (not 0) so charts stop at "now"
  // and future days don't dilute the average.
  const bucketMs = (win.end - win.start) / win.buckets.length;
  const started = Math.ceil((nowTs - win.start.getTime()) / bucketMs);
  const elapsed = Math.min(win.buckets.length, Math.max(1, started));
  const points = win.buckets.map((b, i) => ({
    label: b.label,
    kwh: i < elapsed ? round(totals.get(b.key) ?? 0) : null,
  }));
  const total = points.reduce((s, p) => s + (p.kwh ?? 0), 0);
  return { points, total: round(total), avg: round(total / elapsed) };
}

const pctChange = (cur, prev) => (prev > 0 ? round(((cur - prev) / prev) * 100, 1) : null);

/**
 * Manual-token meters send no readings, so "usage" is what was bought: units
 * vended per bucket, same shape as the meter-reading report.
 */
export async function purchasesReport(meter, unitPriceKobo, period = 'month', anchor = new Date()) {
  const nowTs = Date.now();
  const win = periodWindow(period, anchor);
  const prev = periodWindow(period, win.previous);
  const rows = await db().all(
    `SELECT units, total_kobo, vended_at FROM purchases
     WHERE meter_id = ? AND status = 'vended' AND vended_at >= ? AND vended_at < ?`,
    meter.meter_id, prev.start.toISOString(), win.end.toISOString(),
  );
  const tally = (w) => {
    const units = new Map();
    let spend = 0;
    for (const r of rows) {
      const at = new Date(r.vended_at);
      if (at < w.start || at >= w.end) continue;
      const key = w.bucketOf(at);
      if (key === undefined) continue;
      units.set(key, (units.get(key) ?? 0) + (r.units ?? 0));
      spend += r.total_kobo;
    }
    return { units, spend };
  };
  const curT = tally(win);
  const prevT = tally(prev);
  const cur = summarise(win, curT.units, nowTs);
  const before = summarise(prev, prevT.units, nowTs);
  const purchasesCount = rows.filter((r) => new Date(r.vended_at) >= win.start).length;
  return {
    period,
    source: 'purchases',
    label: win.label,
    from: win.start.toISOString(),
    to: win.end.toISOString(),
    unit: 'kWh',
    points: cur.points,
    totalKwh: cur.total,
    avgUsageKwh: cur.avg,
    avgUsageChangePct: pctChange(cur.total, before.total),
    avgCost: koboToNaira(curT.spend),
    avgCostChangePct: pctChange(curT.spend, prevT.spend),
    previousTotalKwh: before.total,
    projectedNextKwh: before.total,
    purchasesCount,
    unitPrice: koboToNaira(unitPriceKobo),
    note: 'Your meter loads tokens from its remote, so this shows the units you bought rather than metered consumption.',
  };
}

export async function usageReport(meter, unitPriceKobo, period = 'month', anchor = new Date()) {
  if (meter.delivery_mode === 'manual') return purchasesReport(meter, unitPriceKobo, period, anchor);
  const nowTs = Date.now();
  const win = periodWindow(period, anchor);
  const prev = periodWindow(period, win.previous);
  const from = new Date(prev.start.getTime() - 2 * 60 * 60 * 1000); // one reading before, for deltas
  const to = new Date(Math.min(win.end.getTime(), nowTs));
  const rs = from < to ? await readings(meter, from, to) : [];
  const mode = config.geni.energyMode;

  const cur = summarise(win, bucketConsumption(rs, win.bucketOf, mode), nowTs);
  const before = summarise(prev, bucketConsumption(rs, prev.bucketOf, mode), nowTs);
  const price = koboToNaira(unitPriceKobo);

  // Project the next equal-length period from the current daily run-rate.
  const elapsedDays = Math.max(1, Math.min(nowTs, win.end) - win.start) / DAY;
  const lengthDays = (win.end - win.start) / DAY;
  const projectedNext = round((cur.total / elapsedDays) * lengthDays);

  return {
    period,
    source: 'meter',
    label: win.label,
    from: win.start.toISOString(),
    to: win.end.toISOString(),
    unit: 'kWh',
    points: cur.points,
    totalKwh: cur.total,
    avgUsageKwh: cur.avg,
    avgUsageChangePct: pctChange(cur.avg, before.avg),
    avgCost: round(cur.avg * price),
    avgCostChangePct: pctChange(cur.avg * price, before.avg * price),
    previousTotalKwh: before.total,
    projectedNextKwh: projectedNext,
    unitPrice: price,
    note: 'The data you see may be 24 to 36 hours old. Readings arrive from the meter network on a delay.',
  };
}

/**
 * Remaining units estimate ("Points"): units vended in the last 90 days minus
 * consumption since the first of those vends. Returns null when the head-end
 * can't be reached.
 */
/** Units and spend this calendar month (WAT), plus the latest token. */
export async function monthSummary(meter) {
  const win = periodWindow('month', new Date());
  const m = await db().get(
    `SELECT COALESCE(SUM(units), 0) AS units, COALESCE(SUM(total_kobo), 0) AS spend, COUNT(*) AS n
     FROM purchases WHERE meter_id = ? AND status = 'vended' AND vended_at >= ?`,
    meter.meter_id, win.start.toISOString(),
  );
  return { units: round(m.units), spend: koboToNaira(m.spend), purchases: m.n };
}

export async function unitsBalance(meter) {
  if (meter.delivery_mode === 'manual') return null; // no readings to subtract
  const since = new Date(Date.now() - 90 * DAY).toISOString();
  const row = await db().get(
    `SELECT COALESCE(SUM(units), 0) AS units, MIN(vended_at) AS first FROM purchases
     WHERE meter_id = ? AND status = 'vended' AND vended_at >= ?`,
    meter.meter_id, since,
  );
  if (!row.first) return 0;
  try {
    const rs = await readings(meter, new Date(new Date(row.first).getTime() - 2 * 60 * 60 * 1000), new Date());
    const firstTs = new Date(row.first).getTime();
    const used = [...bucketConsumption(rs, (t) => (t.getTime() >= firstTs ? 'x' : undefined), config.geni.energyMode).values()]
      .reduce((s, v) => s + v, 0);
    return round(Math.max(0, row.units - used));
  } catch (err) {
    console.error('[usage] balance unavailable', err.message);
    return null;
  }
}

const liveCache = new Map();

/** Real-time "virtual display" values; cached briefly to absorb 5s polling. */
export async function liveReading(meter) {
  // No GPRS link in manual mode: never poll the head-end.
  if (meter.delivery_mode === 'manual') {
    return { mode: 'manual', online: false, lastSeen: null, readingAt: null, volts: null, amps: null, kw: null, meterBalanceKwh: null, relayState: meter.relay_state };
  }
  const hit = liveCache.get(meter.meter_id);
  if (hit && hit.expires > Date.now()) return hit.value;

  const client = geni();
  const [status, rows] = await Promise.all([
    client.onlineStatus(meter.meter_id).catch(() => ({ online: false, lastSeen: null })),
    client
      .instantaneous({
        meterId: meter.meter_id,
        isThreePhase: Boolean(meter.is_three_phase),
        from: new Date(Date.now() - DAY),
        to: new Date(),
      })
      .catch(() => []),
  ]);
  const latest = rows.map(parseCurveRow).sort((a, b) => b.at - a.at)[0];
  const pick = (fn) => {
    if (!latest) return null;
    const col = fn(latest.values);
    return col === undefined ? null : latest.values[col];
  };
  const value = {
    mode: 'ota',
    online: status.online,
    lastSeen: status.lastSeen ?? (latest ? latest.at.toISOString() : null),
    readingAt: latest ? latest.at.toISOString() : null,
    volts: pick(voltageColumn),
    amps: pick(currentColumn),
    kw: pick(powerColumn),
    meterBalanceKwh: pick(balanceColumn),
    relayState: meter.relay_state,
  };
  liveCache.set(meter.meter_id, { value, expires: Date.now() + config.liveCacheSeconds * 1000 });
  return value;
}
