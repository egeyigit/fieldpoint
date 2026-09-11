/**
 * Notifications: the in-app delivery layer. A row is created when a work order
 * is assigned to a user, when someone comments on a thread they are assigned to,
 * and when one of their assigned orders passes its due date. Rows are always
 * owned by exactly one recipient (`user_id`) and read-marking is per row.
 *
 * `source_key` makes creation idempotent: the overdue sweep can run repeatedly
 * (and across restarts) without ever producing a second row for the same order,
 * because a UNIQUE constraint turns the duplicate INSERT into a no-op.
 */
const SQL = `
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL
    CHECK (type IN ('assignment', 'comment', 'overdue')),
  work_order_id INTEGER REFERENCES work_orders(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  source_key TEXT NOT NULL UNIQUE,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, read_at);
`;

export const migration004Notifications = {
  version: 4,
  name: 'notifications',
  up(db) {
    db.exec(SQL);
  },
};
