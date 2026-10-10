import { db, now } from '../db.js';

/** Store an in-app notification. Never throws into the caller. */
export async function notify({ recipientType, recipientId, kind, title, body }) {
  try {
    await db().run(
      `INSERT INTO notifications (recipient_type, recipient_id, kind, title, body) VALUES (?, ?, ?, ?, ?)`,
      recipientType, String(recipientId), kind, title, body,
    );
  } catch (err) {
    console.error('[notify] failed', err.message);
  }
}

export async function listNotifications(recipientType, recipientId, limit = 50) {
  const rows = await db().all(
    `SELECT id, kind, title, body, read_at, created_at FROM notifications
     WHERE recipient_type = ? AND recipient_id = ? ORDER BY id DESC LIMIT ?`,
    recipientType, String(recipientId), limit,
  );
  return rows.map((n) => ({
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    read: Boolean(n.read_at),
    createdAt: n.created_at,
  }));
}

export async function markAllRead(recipientType, recipientId) {
  await db().run(
    `UPDATE notifications SET read_at = ? WHERE recipient_type = ? AND recipient_id = ? AND read_at IS NULL`,
    now(), recipientType, String(recipientId),
  );
}

export async function unreadCount(recipientType, recipientId) {
  const row = await db().get(
    `SELECT COUNT(*) AS n FROM notifications WHERE recipient_type = ? AND recipient_id = ? AND read_at IS NULL`,
    recipientType, String(recipientId),
  );
  return row.n;
}
