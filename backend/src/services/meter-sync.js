// Keeps smeter's view of a meter in step with the head-end:
//  - power switches stay "pending" until the head-end's control task succeeds
//    (and roll back if it fails);
//  - tokens pushed over GPRS are marked delivered, or handed to the tenant to
//    key in when the push fails;
//  - the meter's phase type (single / three-phase / CT) is re-read, since the
//    load-profile queries only return rows for the right one.
// Vercel's cron runs once a day, so these also run when a meter is viewed.
import { db, now } from '../db.js';
import { geni, geniMode } from '../geni/index.js';
import { notify } from './notifications.js';

const PHASE_RECHECK_MS = 24 * 60 * 60 * 1000;
const TASK_RECHECK_MS = 10 * 1000; // absorbs the app's 5s polling
const lastTaskCheck = new Map();

function throttled(key) {
  const at = lastTaskCheck.get(key) ?? 0;
  if (Date.now() - at < TASK_RECHECK_MS) return true;
  lastTaskCheck.set(key, Date.now());
  return false;
}

const RELAY_DONE = { disconnect_pending: 'disconnected', reconnect_pending: 'connected' };
const RELAY_UNDO = { disconnect_pending: 'connected', reconnect_pending: 'disconnected' };

/** Settle a pending power switch from its head-end task. Returns the (possibly updated) meter row. */
export async function syncRelay(meter, { force = false } = {}) {
  if (!meter?.relay_task_id || !RELAY_DONE[meter.relay_state]) return meter;
  if (!force && throttled(`relay:${meter.meter_id}`)) return meter;
  let task;
  try {
    task = await geni().taskStatus('control', meter.relay_task_id);
  } catch (err) {
    console.error('[meter-sync] control task check failed', meter.meter_id, err.message);
    return meter;
  }
  if (!task || task.status === 'pending') return meter;
  const disconnect = meter.relay_state === 'disconnect_pending';
  const next = task.status === 'success' ? RELAY_DONE[meter.relay_state] : RELAY_UNDO[meter.relay_state];
  const r = await db().run(
    'UPDATE meters SET relay_state = ?, relay_task_id = NULL WHERE id = ? AND relay_task_id = ? AND relay_state = ?',
    next, meter.id, meter.relay_task_id, meter.relay_state,
  );
  if (r.changes !== 1) return db().get('SELECT * FROM meters WHERE id = ?', meter.id); // someone else settled it
  if (task.status === 'success') {
    await notify({
      recipientType: 'tenant', recipientId: meter.meter_id, kind: 'relay',
      title: disconnect ? 'Power disconnected' : 'Power reconnected',
      body: disconnect
        ? 'Your property owner remotely disconnected supply to this meter. Contact them for help.'
        : 'Supply to your meter has been restored.',
    });
    await notify({
      recipientType: 'landlord', recipientId: meter.landlord_id, kind: 'relay',
      title: disconnect ? 'Meter switched off' : 'Meter switched on',
      body: `Meter ${meter.meter_id} confirmed the ${disconnect ? 'disconnection' : 'reconnection'}.`,
    });
  } else {
    await notify({
      recipientType: 'landlord', recipientId: meter.landlord_id, kind: 'relay',
      title: disconnect ? 'Couldn’t switch the meter off' : 'Couldn’t switch the meter on',
      body: `Meter ${meter.meter_id} didn’t carry out the ${disconnect ? 'disconnection' : 'reconnection'}. Check that it’s powered and online, then try again.`,
    });
  }
  return db().get('SELECT * FROM meters WHERE id = ?', meter.id);
}

/** Re-read the meter's phase type from the head-end (live mode, at most daily). */
export async function syncPhase(meter, { force = false } = {}) {
  if (!meter || geniMode() !== 'live' || meter.delivery_mode === 'manual') return meter;
  const checked = meter.head_end_checked_at ? new Date(meter.head_end_checked_at).getTime() : 0;
  if (!force && Date.now() - checked < PHASE_RECHECK_MS) return meter;
  try {
    const info = await geni().getMeter(meter.meter_id);
    const phase = info ? info.phaseType ?? (info.isThreePhase ? 1 : 0) : meter.is_three_phase;
    await db().run('UPDATE meters SET is_three_phase = ?, head_end_checked_at = ? WHERE id = ?', phase, now(), meter.id);
    return { ...meter, is_three_phase: phase, head_end_checked_at: now() };
  } catch (err) {
    console.error('[meter-sync] meter lookup failed', meter.meter_id, err.message);
    return meter;
  }
}

/** Phase type, then any pending power switch. */
export async function refreshMeter(meter) {
  return syncRelay(await syncPhase(meter));
}

/** Confirm (or hand back) tokens pushed over GPRS in the last week. */
export async function syncDeliveries({ meterId = null, limit = 20 } = {}) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const rows = await db().all(
    `SELECT reference, meter_id, token, delivery_task_id FROM purchases
     WHERE delivery = 'ota_queued' AND delivery_task_id IS NOT NULL AND vended_at >= ?
       ${meterId ? 'AND meter_id = ?' : ''} ORDER BY id DESC LIMIT ?`,
    ...(meterId ? [since, meterId, limit] : [since, limit]),
  );
  for (const p of rows) {
    if (throttled(`token:${p.reference}`)) continue;
    let task;
    try {
      task = await geni().taskStatus('token', p.delivery_task_id);
    } catch (err) {
      console.error('[meter-sync] token task check failed', p.reference, err.message);
      continue;
    }
    if (!task || task.status === 'pending') continue;
    const delivered = task.status === 'success';
    const r = await db().run(
      "UPDATE purchases SET delivery = ?, updated_at = ? WHERE reference = ? AND delivery = 'ota_queued'",
      delivered ? 'ota_delivered' : 'manual', now(), p.reference,
    );
    if (r.changes === 1 && !delivered) {
      await notify({
        recipientType: 'tenant', recipientId: p.meter_id, kind: 'vended',
        title: 'Enter your token on the meter',
        body: `We couldn’t load your units onto the meter automatically. Key in token ${p.token} on the meter or its remote.`,
      });
    }
  }
}

/** Sweeper pass: every pending switch and recent token push. */
export async function syncAll() {
  const pending = await db().all(
    "SELECT * FROM meters WHERE relay_task_id IS NOT NULL AND relay_state IN ('disconnect_pending','reconnect_pending') LIMIT 50",
  );
  for (const m of pending) await syncRelay(m, { force: true });
  await syncDeliveries({ limit: 50 });
}
