const COLUMNS = `t.id, t.name, t.title, t.description, t.priority,
  t.estimated_minutes AS estimatedMinutes, t.is_archived AS isArchived,
  t.created_by AS createdBy, t.created_at AS createdAt, t.updated_at AS updatedAt,
  cu.name AS createdByName`;
const FROM = `FROM work_order_templates t LEFT JOIN users cu ON cu.id = t.created_by`;

const UPDATABLE = ['name', 'title', 'description', 'priority', 'estimatedMinutes', 'isArchived'];
const COLUMN_BY_FIELD = {
  estimatedMinutes: 'estimated_minutes',
  isArchived: 'is_archived',
};

export function createTemplateRepository(db) {
  const byId = db.prepare(`SELECT ${COLUMNS} ${FROM} WHERE t.id = ?`);
  const byName = db.prepare(`SELECT id FROM work_order_templates WHERE name = ? COLLATE NOCASE`);
  const insert = db.prepare(
    `INSERT INTO work_order_templates (name, title, description, priority, estimated_minutes, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertItem = db.prepare(
    `INSERT INTO work_order_template_items (template_id, position, text) VALUES (?, ?, ?)`,
  );
  const clearItems = db.prepare(`DELETE FROM work_order_template_items WHERE template_id = ?`);
  const selectItems = db.prepare(
    `SELECT id, text, position FROM work_order_template_items WHERE template_id = ? ORDER BY position, id`,
  );
  const remove = db.prepare(`DELETE FROM work_order_templates WHERE id = ?`);

  /** Replaces the checklist wholesale; positions are the array order. */
  function writeItems(templateId, items) {
    clearItems.run(templateId);
    items.forEach((text, index) => insertItem.run(templateId, index, text));
  }

  function hydrate(row) {
    return row ? { ...row, isArchived: Boolean(row.isArchived), items: selectItems.all(row.id) } : null;
  }

  return {
    findById: (id) => hydrate(byId.get(id)),
    /** Case-insensitive, so two templates cannot differ only in capitalisation. */
    nameTaken(name, exceptId = null) {
      const row = byName.get(name);
      return Boolean(row) && row.id !== exceptId;
    },
    list({ includeArchived = false } = {}) {
      const where = includeArchived ? '' : 'WHERE t.is_archived = 0';
      return db
        .prepare(`SELECT ${COLUMNS} ${FROM} ${where} ORDER BY t.name COLLATE NOCASE, t.id`)
        .all()
        .map(hydrate);
    },
    create(data, userId) {
      const result = insert.run(
        data.name, data.title, data.description, data.priority,
        data.estimatedMinutes ?? null, userId, userId,
      );
      const id = Number(result.lastInsertRowid);
      writeItems(id, data.items ?? []);
      return hydrate(byId.get(id));
    },
    update(id, data, userId) {
      const fields = UPDATABLE.filter((key) => data[key] !== undefined);
      if (fields.length > 0) {
        const assignments = fields.map((key) => `${COLUMN_BY_FIELD[key] ?? key} = ?`).join(', ');
        const values = fields.map((key) => (typeof data[key] === 'boolean' ? Number(data[key]) : data[key]));
        db.prepare(
          `UPDATE work_order_templates SET ${assignments}, updated_by = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
        ).run(...values, userId, id);
      }
      if (data.items !== undefined) writeItems(id, data.items);
      return hydrate(byId.get(id));
    },
    remove: (id) => remove.run(id).changes > 0,
    itemsFor: (id) => selectItems.all(id),
  };
}
