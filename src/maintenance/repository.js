const COLUMNS = `s.id, s.site_id AS siteId, s.template_id AS templateId, s.title, s.description,
  s.priority, s.assigned_to AS assignedTo, s.interval_days AS intervalDays,
  s.next_due_date AS nextDueDate, s.last_generated_at AS lastGeneratedAt,
  s.is_active AS isActive, s.skip_if_open AS skipIfOpen,
  s.created_at AS createdAt, s.updated_at AS updatedAt,
  site.name AS siteName, au.name AS assignedToName, t.name AS templateName,
  (SELECT COUNT(*) FROM work_orders w
     WHERE w.schedule_id = s.id AND w.status NOT IN ('done', 'cancelled')) AS openOrderCount`;
const FROM = `FROM maintenance_schedules s
  JOIN sites site ON site.id = s.site_id
  LEFT JOIN users au ON au.id = s.assigned_to
  LEFT JOIN work_order_templates t ON t.id = s.template_id`;

const UPDATABLE = [
  'templateId', 'title', 'description', 'priority', 'assignedTo',
  'intervalDays', 'nextDueDate', 'isActive', 'skipIfOpen',
];
const COLUMN_BY_FIELD = {
  templateId: 'template_id',
  assignedTo: 'assigned_to',
  intervalDays: 'interval_days',
  nextDueDate: 'next_due_date',
  isActive: 'is_active',
  skipIfOpen: 'skip_if_open',
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** `date` plus `days`, as YYYY-MM-DD. Pure, so the generator is testable. */
export function addDays(date, days) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The next due date strictly after `today`, stepping by whole intervals. A
 * schedule that was missed for months catches up in one jump instead of
 * generating a backlog of identical orders nobody asked for.
 */
export function advanceDueDate(nextDueDate, intervalDays, today) {
  let due = addDays(nextDueDate, intervalDays);
  while (due <= today) due = addDays(due, intervalDays);
  return due;
}

export function createScheduleRepository(db) {
  const byId = db.prepare(`SELECT ${COLUMNS} ${FROM} WHERE s.id = ?`);
  const insert = db.prepare(
    `INSERT INTO maintenance_schedules
       (site_id, template_id, title, description, priority, assigned_to, interval_days, next_due_date, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const remove = db.prepare(`DELETE FROM maintenance_schedules WHERE id = ?`);
  const markGenerated = db.prepare(
    `UPDATE maintenance_schedules
     SET next_due_date = ?, last_generated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`,
  );

  const hydrate = (row) =>
    (row
      ? {
        ...row,
        isActive: Boolean(row.isActive),
        skipIfOpen: Boolean(row.skipIfOpen),
        hasOpenGeneratedOrder: row.openOrderCount > 0,
      }
      : null);

  return {
    findById: (id) => hydrate(byId.get(id)),
    list({ siteId, dueOnly = false, includeInactive = false, today = todayIso() } = {}) {
      // A schedule on a soft-deleted site is not due for anything.
      const clauses = ['site.deleted_at IS NULL'];
      const params = [];
      if (!includeInactive) clauses.push('s.is_active = 1');
      if (siteId !== undefined) {
        clauses.push('s.site_id = ?');
        params.push(siteId);
      }
      if (dueOnly) {
        clauses.push('s.next_due_date <= ?');
        params.push(today);
      }
      return db
        .prepare(`SELECT ${COLUMNS} ${FROM} WHERE ${clauses.join(' AND ')} ORDER BY s.next_due_date, s.id`)
        .all(...params)
        .map(hydrate);
    },
    create(data, userId) {
      const result = insert.run(
        data.siteId, data.templateId ?? null, data.title, data.description, data.priority,
        data.assignedTo ?? null, data.intervalDays, data.nextDueDate, userId, userId,
      );
      return hydrate(byId.get(Number(result.lastInsertRowid)));
    },
    update(id, data, userId) {
      const fields = UPDATABLE.filter((key) => data[key] !== undefined);
      if (fields.length === 0) return hydrate(byId.get(id));
      const assignments = fields.map((key) => `${COLUMN_BY_FIELD[key] ?? key} = ?`).join(', ');
      const values = fields.map((key) => (typeof data[key] === 'boolean' ? Number(data[key]) : data[key]));
      db.prepare(
        `UPDATE maintenance_schedules SET ${assignments}, updated_by = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
      ).run(...values, userId, id);
      return hydrate(byId.get(id));
    },
    remove: (id) => remove.run(id).changes > 0,
    markGenerated: (id, nextDueDate) => markGenerated.run(nextDueDate, id),
    // True when this schedule has already generated an order that is not yet
    // in a terminal status. Read inside the generator's transaction.
    hasOpenGeneratedOrder: (id) =>
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM work_orders
           WHERE schedule_id = ? AND status NOT IN ('done', 'cancelled')`,
        )
        .get(id).count > 0,
  };
}

export function todayIso(now = new Date()) {
  return now.toISOString().slice(0, 10);
}
