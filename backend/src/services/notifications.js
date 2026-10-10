import { db } from '../db.js';

/** Store an in-app notification. Never throws into the caller. */
export function notify({ recipientType, recipientId, kind, title, body }) {
  try {
    db()
      .prepare(
        `INSERT INTO notifications (recipient_type, recipient_id, kind, title, body) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(recipientType, String(recipientId), kind, title, body);
  } catch (err) {
    console.error('[notify] failed', err.message);
  }
}

export function listNotifications(recipientType, recipientId, limit = 50) {
  return db()
    .prepare(
      `SELECT id, kind, title, body, read_at, created_at FROM notifications
       WHERE recipient_type = ? AND recipient_id = ? ORDER BY id DESC LIMIT ?`,
    )
    .all(recipientType, String(recipientId), limit)
    .map((n) => ({
      id: n.id,
      kind: n.kind,
      title: n.title,
      body: n.body,
      read: Boolean(n.read_at),
      createdAt: n.created_at,
    }));
}

export function markAllRead(recipientType, recipientId) {
  db()
    .prepare(
      `UPDATE notifications SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE recipient_type = ? AND recipient_id = ? AND read_at IS NULL`,
    )
    .run(recipientType, String(recipientId));
}

export function unreadCount(recipientType, recipientId) {
  return db()
    .prepare(`SELECT COUNT(*) AS n FROM notifications WHERE recipient_type = ? AND recipient_id = ? AND read_at IS NULL`)
    .get(recipientType, String(recipientId)).n;
}
