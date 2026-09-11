/**
 * Notifications data access. Every read is scoped to a single owner: there is no
 * cross-user path. Creation is idempotent through the UNIQUE `source_key`, so
 * emitting the same assignment or overdue notification twice never yields a
 * second row.
 */
export function createNotificationRepository(db) {
  const insert = db.prepare(
    `INSERT INTO notifications (user_id, type, work_order_id, title, body, source_key)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_key) DO NOTHING`,
  );
  const listForUser = db.prepare(
    `SELECT id, user_id AS userId, type, work_order_id AS workOrderId, title, body,
            read_at AS readAt, created_at AS createdAt
     FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
  );
  const unreadCount = db.prepare(
    `SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL`,
  );
  const findOwned = db.prepare(
    `SELECT id, user_id AS userId, read_at AS readAt FROM notifications WHERE id = ? AND user_id = ?`,
  );
  const markRead = db.prepare(
    `UPDATE notifications SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ? AND user_id = ? AND read_at IS NULL`,
  );
  // Assigned, still open, past its due date, and not yet notified as overdue.
  const overdue = db.prepare(
    `SELECT w.id, w.title, w.assigned_to AS assignedTo
     FROM work_orders w JOIN sites s ON s.id = w.site_id AND s.deleted_at IS NULL
     WHERE w.assigned_to IS NOT NULL
       AND w.due_date IS NOT NULL AND w.due_date < date('now')
       AND w.status NOT IN ('done', 'cancelled')`,
  );

  const repo = {
    /** Idempotent: a duplicate source_key is silently ignored. */
    create({ userId, type, workOrderId = null, title, body = '', sourceKey }) {
      return insert.run(userId, type, workOrderId, title, body, sourceKey).changes > 0;
    },
    listForUser(userId, limit = 50) {
      return {
        notifications: listForUser.all(userId, limit),
        unread: unreadCount.get(userId).count,
      };
    },
    unreadCount: (userId) => unreadCount.get(userId).count,
    /**
     * Marks one notification read. Returns 'ok' when the caller owns it (whether
     * or not it was already read — read is idempotent) and 'not_found' when the
     * row is missing or belongs to someone else.
     */
    markRead(id, userId) {
      if (!findOwned.get(id, userId)) return 'not_found';
      markRead.run(id, userId);
      return 'ok';
    },
    /** Emits one overdue notification per assigned overdue order; safe to repeat. */
    sweepOverdue() {
      let created = 0;
      for (const order of overdue.all()) {
        const emitted = repo.create({
          userId: order.assignedTo,
          type: 'overdue',
          workOrderId: order.id,
          title: `Overdue: ${order.title}`,
          body: 'This work order has passed its due date.',
          sourceKey: `overdue:${order.id}`,
        });
        if (emitted) created += 1;
      }
      return created;
    },
  };
  return repo;
}
