// Background reconciliation:
//  - pending payments with no webhook after N minutes are verified directly
//    with the gateway (the "audit alert" path);
//  - paid purchases whose token generation failed are retried.
import { config } from '../config.js';
import { db, now } from '../db.js';
import { settlePayment, vend } from './vending.js';

export async function sweepOnce() {
  const auditBefore = new Date(Date.now() - config.payments.auditAfterMinutes * 60 * 1000).toISOString();
  const abandonBefore = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const stale = db()
    .prepare(`SELECT reference, created_at FROM purchases WHERE status = 'pending' AND created_at < ? LIMIT 50`)
    .all(auditBefore);
  for (const p of stale) {
    try {
      const after = await settlePayment(p.reference, { source: 'audit' });
      if (after.status === 'pending' && p.created_at < abandonBefore) {
        db()
          .prepare(`UPDATE purchases SET status = 'abandoned', updated_at = ? WHERE reference = ? AND status = 'pending'`)
          .run(now(), p.reference);
      }
    } catch (err) {
      console.error('[sweeper] audit failed', p.reference, err.message);
    }
  }

  const unvended = db()
    .prepare(`SELECT reference FROM purchases WHERE status = 'paid' AND updated_at < ? LIMIT 20`)
    .all(new Date(Date.now() - 60 * 1000).toISOString());
  for (const p of unvended) {
    try {
      await vend(p.reference);
    } catch (err) {
      console.error('[sweeper] vend retry failed', p.reference, err.message);
    }
  }
}

export function startSweeper(intervalMs = 60 * 1000) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await sweepOnce();
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
