import { encodeCursor, decodeCursor, keysetWhereClause } from '../cursor.js';

const COLUMNS = `w.id, w.site_id AS siteId, w.title, w.description, w.status, w.priority,
  w.assigned_to AS assignedTo, w.due_date AS dueDate, w.completed_at AS completedAt,
  w.created_by AS createdBy, w.updated_by AS updatedBy, w.created_at AS createdAt, w.updated_at AS updatedAt,
  s.name AS siteName, s.lat AS siteLat, s.lng AS siteLng,
  au.name AS assignedToName, cu.name AS createdByName`;
const FROM = `FROM work_orders w
  JOIN sites s ON s.id = w.site_id
  LEFT JOIN users au ON au.id = w.assigned_to
  LEFT JOIN users cu ON cu.id = w.created_by`;

const UPDATABLE = ['title', 'description', 'status', 'priority', 'assignedTo', 'dueDate'];
const COLUMN_BY_FIELD = { assignedTo: 'assigned_to', dueDate: 'due_date' };
const TERMINAL_STATUSES = new Set(['done', 'cancelled']);
const OPEN_STATUSES = ['open', 'in_progress', 'blocked'];

// Urgent first. SQLite has no enum ordering, so rank explicitly.
const PRIORITY_RANK = `CASE w.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END`;
// Each sort ends in the primary key so equal keys keep a stable order.
const ORDER_BY_SORT = {
  // Undated orders sort last rather than first.
  due: `CASE WHEN w.due_date IS NULL THEN 1 ELSE 0 END, w.due_date ASC, ${PRIORITY_RANK}, w.id ASC`,
  priority: `${PRIORITY_RANK}, w.due_date ASC, w.id ASC`,
  created: 'w.created_at DESC, w.id DESC',
  updated: 'w.updated_at DESC, w.id DESC',
};

const DUE_NULL_RANK = `CASE WHEN w.due_date IS NULL THEN 1 ELSE 0 END`;

const KEYSET_META = {
  due: {
    columns: [DUE_NULL_RANK, 'w.due_date', PRIORITY_RANK, 'w.id'],
    directions: ['ASC', 'ASC', 'ASC', 'ASC'],
  },
  priority: {
    columns: [PRIORITY_RANK, 'w.due_date', 'w.id'],
    directions: ['ASC', 'ASC', 'ASC'],
  },
  created: { columns: ['w.created_at', 'w.id'], directions: ['DESC', 'DESC'] },
  updated: { columns: ['w.updated_at', 'w.id'], directions: ['DESC', 'DESC'] },
};

const PRIORITY_VALUE = { urgent: 0, high: 1, normal: 2, low: 3 };

function woCursorValues(row, sort) {
  switch (sort) {
    case 'due':
      return [row.dueDate === null ? 1 : 0, row.dueDate, PRIORITY_VALUE[row.priority] ?? 3, row.id];
    case 'priority':
      return [PRIORITY_VALUE[row.priority] ?? 3, row.dueDate, row.id];
    case 'created':
      return [row.createdAt, row.id];
    case 'updated':
      return [row.updatedAt, row.id];
    default:
      return [row.dueDate === null ? 1 : 0, row.dueDate, PRIORITY_VALUE[row.priority] ?? 3, row.id];
  }
}

export function createWorkOrderRepository(db) {
  const byId = db.prepare(`SELECT ${COLUMNS} ${FROM} WHERE w.id = ?`);
  const insert = db.prepare(
    `INSERT INTO work_orders (site_id, title, description, status, priority, assigned_to, due_date, completed_at, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const remove = db.prepare(`DELETE FROM work_orders WHERE id = ?`);
  const insertComment = db.prepare(
    `INSERT INTO work_order_comments (work_order_id, author_id, body) VALUES (?, ?, ?)`,
  );
  const listComments = db.prepare(
    `SELECT c.id, c.work_order_id AS workOrderId, c.author_id AS authorId, u.name AS authorName,
            c.body, c.created_at AS createdAt
     FROM work_order_comments c LEFT JOIN users u ON u.id = c.author_id
     WHERE c.work_order_id = ? ORDER BY c.id ASC`,
  );
  const summary = db.prepare(
    `SELECT w.status, w.priority, COUNT(*) AS count FROM work_orders w
     JOIN sites s ON s.id = w.site_id AND s.deleted_at IS NULL
     GROUP BY w.status, w.priority`,
  );

  function buildFilter(filters) {
    // Work orders on a soft-deleted site stay out of every listing.
    const clauses = ['s.deleted_at IS NULL'];
    const params = [];
    if (filters.siteId !== undefined) {
      clauses.push('w.site_id = ?');
      params.push(filters.siteId);
    }
    if (filters.status) {
      clauses.push('w.status = ?');
      params.push(filters.status);
    }
    if (filters.openOnly) {
      clauses.push(`w.status IN (${OPEN_STATUSES.map(() => '?').join(', ')})`);
      params.push(...OPEN_STATUSES);
    }
    if (filters.priority) {
      clauses.push('w.priority = ?');
      params.push(filters.priority);
    }
    if (filters.assignedTo !== undefined) {
      clauses.push('w.assigned_to = ?');
      params.push(filters.assignedTo);
    }
    if (filters.overdue) {
      clauses.push(
        `w.due_date IS NOT NULL AND w.due_date < date('now') AND w.status NOT IN ('done', 'cancelled')`,
      );
    }
    if (filters.q) {
      clauses.push(`(w.title LIKE ? ESCAPE '\\' OR w.description LIKE ? ESCAPE '\\')`);
      const pattern = `%${escapeLike(filters.q)}%`;
      params.push(pattern, pattern);
    }
    return { where: `WHERE ${clauses.join(' AND ')}`, params };
  }

  return {
    findById: (id) => byId.get(id) ?? null,
    list(filters) {
      const { where, params } = buildFilter(filters);
      const order = ORDER_BY_SORT[filters.sort] ?? ORDER_BY_SORT.due;
      const sortKey = filters.sort && ORDER_BY_SORT[filters.sort] ? filters.sort : 'due';

      if (filters.cursor) {
        const meta = KEYSET_META[sortKey];
        const cursorVals = decodeCursor(filters.cursor);
        if (cursorVals.length !== meta.columns.length) {
          throw Object.assign(new Error('Invalid cursor'), { status: 400 });
        }
        const ks = keysetWhereClause({ columns: meta.columns, directions: meta.directions, values: cursorVals });
        const combinedWhere = `${where} AND (${ks.sql})`;
        const combinedParams = [...params, ...ks.params];
        const rows = db
          .prepare(`SELECT ${COLUMNS} ${FROM} ${combinedWhere} ORDER BY ${order} LIMIT ?`)
          .all(...combinedParams, filters.limit);
        const { total } = db
          .prepare(`SELECT COUNT(*) AS total FROM work_orders w JOIN sites s ON s.id = w.site_id ${where}`)
          .get(...params);
        const nextCursor = rows.length === filters.limit
          ? encodeCursor(woCursorValues(rows[rows.length - 1], sortKey))
          : null;
        return { rows, total, nextCursor };
      }

      // Legacy offset pagination.
      const rows = db
        .prepare(`SELECT ${COLUMNS} ${FROM} ${where} ORDER BY ${order} LIMIT ? OFFSET ?`)
        .all(...params, filters.limit, filters.offset);
      const { total } = db
        .prepare(`SELECT COUNT(*) AS total FROM work_orders w JOIN sites s ON s.id = w.site_id ${where}`)
        .get(...params);
      const nextCursor = rows.length === filters.limit
        ? encodeCursor(woCursorValues(rows[rows.length - 1], sortKey))
        : null;
      return { rows, total, nextCursor };
    },
    create(data, userId) {
      const completedAt = TERMINAL_STATUSES.has(data.status) ? nowIso() : null;
      const result = insert.run(
        data.siteId, data.title, data.description, data.status, data.priority,
        data.assignedTo ?? null, data.dueDate ?? null, completedAt, userId, userId,
      );
      return byId.get(result.lastInsertRowid);
    },
    update(id, data, userId) {
      const current = byId.get(id);
      if (!current) return null;
      const fields = UPDATABLE.filter((key) => data[key] !== undefined);
      const assignments = fields.map((key) => `${COLUMN_BY_FIELD[key] ?? key} = ?`);
      const values = fields.map((key) => data[key]);
      // completed_at is derived from status, never set by the client.
      if (data.status !== undefined && data.status !== current.status) {
        assignments.push('completed_at = ?');
        values.push(TERMINAL_STATUSES.has(data.status) ? nowIso() : null);
      }
      if (assignments.length === 0) return current;
      db.prepare(
        `UPDATE work_orders SET ${assignments.join(', ')}, updated_by = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
      ).run(...values, userId, id);
      return byId.get(id);
    },
    remove: (id) => remove.run(id).changes > 0,
    addComment: (workOrderId, authorId, body) => {
      const result = insertComment.run(workOrderId, authorId, body);
      return listComments.all(workOrderId).find((comment) => comment.id === Number(result.lastInsertRowid));
    },
    comments: (workOrderId) => listComments.all(workOrderId),
    summary: () => summary.all(),
  };
}

function nowIso() {
  return new Date().toISOString();
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
