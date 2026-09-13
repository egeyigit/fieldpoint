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
            c.body, c.created_at AS createdAt, c.edited_at AS editedAt
     FROM work_order_comments c LEFT JOIN users u ON u.id = c.author_id
     WHERE c.work_order_id = ? AND c.deleted_at IS NULL ORDER BY c.id ASC`,
  );
  const commentById = db.prepare(
    `SELECT c.id, c.work_order_id AS workOrderId, c.author_id AS authorId,
            c.body, c.created_at AS createdAt, c.edited_at AS editedAt, c.deleted_at AS deletedAt
     FROM work_order_comments c WHERE c.id = ?`,
  );
  const updateComment = db.prepare(
    `UPDATE work_order_comments SET body = ?, edited_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
  );
  const softDeleteComment = db.prepare(
    `UPDATE work_order_comments SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND deleted_at IS NULL`,
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
      const rows = db
        .prepare(`SELECT ${COLUMNS} ${FROM} ${where} ORDER BY ${order} LIMIT ? OFFSET ?`)
        .all(...params, filters.limit, filters.offset);
      const { total } = db
        .prepare(`SELECT COUNT(*) AS total FROM work_orders w JOIN sites s ON s.id = w.site_id ${where}`)
        .get(...params);
      return { rows, total };
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
    findComment: (commentId) => commentById.get(commentId) ?? null,
    editComment: (commentId, body) => {
      updateComment.run(body, commentId);
      return commentById.get(commentId);
    },
    removeComment: (commentId) => softDeleteComment.run(commentId).changes > 0,
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
