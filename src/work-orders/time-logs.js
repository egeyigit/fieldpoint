const COLUMNS = `l.id, l.work_order_id AS workOrderId, l.user_id AS userId, u.name AS userName,
  l.started_at AS startedAt, l.ended_at AS endedAt, l.note, l.created_at AS createdAt`;
const FROM = `FROM work_order_time_logs l LEFT JOIN users u ON u.id = l.user_id`;

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

/** Whole seconds between two ISO timestamps, never negative. */
export function secondsBetween(startedAt, endedAt) {
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, Math.round((end - start) / MS_PER_SECOND));
}

/** Whole minutes between two ISO timestamps, never negative. */
export function minutesBetween(startedAt, endedAt) {
  return Math.floor(secondsBetween(startedAt, endedAt) / SECONDS_PER_MINUTE);
}

export function createTimeLogRepository(db) {
  const byId = db.prepare(`SELECT ${COLUMNS} ${FROM} WHERE l.id = ?`);
  const listFor = db.prepare(`SELECT ${COLUMNS} ${FROM} WHERE l.work_order_id = ? ORDER BY l.started_at, l.id`);
  const openForUser = db.prepare(`SELECT ${COLUMNS} ${FROM} WHERE l.user_id = ? AND l.ended_at IS NULL`);
  const insert = db.prepare(
    `INSERT INTO work_order_time_logs (work_order_id, user_id, started_at, ended_at, note) VALUES (?, ?, ?, ?, ?)`,
  );
  const close = db.prepare(`UPDATE work_order_time_logs SET ended_at = ?, note = ? WHERE id = ?`);
  const remove = db.prepare(`DELETE FROM work_order_time_logs WHERE id = ?`);

  const hydrate = (row) =>
    row
      ? {
          ...row,
          seconds: row.endedAt ? secondsBetween(row.startedAt, row.endedAt) : null,
          minutes: row.endedAt ? minutesBetween(row.startedAt, row.endedAt) : null,
        }
      : null;

  return {
    findById: (id) => hydrate(byId.get(id)),
    listFor: (workOrderId) => listFor.all(workOrderId).map(hydrate),
    /** The one entry a user currently has running, or null. */
    openForUser: (userId) => hydrate(openForUser.get(userId)),
    start(workOrderId, userId, startedAt = new Date().toISOString()) {
      const result = insert.run(workOrderId, userId, startedAt, null, '');
      return hydrate(byId.get(Number(result.lastInsertRowid)));
    },
    stop(id, note = '', endedAt = new Date().toISOString()) {
      close.run(endedAt, note, id);
      return hydrate(byId.get(id));
    },
    /** A manual entry for work done away from the app. */
    addManual(workOrderId, userId, { startedAt, endedAt, note = '' }) {
      const result = insert.run(workOrderId, userId, startedAt, endedAt, note);
      return hydrate(byId.get(Number(result.lastInsertRowid)));
    },
    remove: (id) => remove.run(id).changes > 0,
    /** Total logged seconds, ignoring an entry that is still running. */
    totalSeconds(workOrderId) {
      return listFor
        .all(workOrderId)
        .reduce((sum, row) => sum + (row.endedAt ? secondsBetween(row.startedAt, row.endedAt) : 0), 0);
    },
    /** Total logged minutes, ignoring an entry that is still running. */
    totalMinutes(workOrderId) {
      return Math.floor(this.totalSeconds(workOrderId) / SECONDS_PER_MINUTE);
    },
  };
}
