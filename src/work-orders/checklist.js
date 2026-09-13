const ITEM_COLUMNS = `c.id, c.work_order_id AS workOrderId, c.position, c.text,
  c.is_done AS isDone, c.done_by AS doneBy, c.done_at AS doneAt, u.name AS doneByName`;

/**
 * A work order's own checklist. Items are copied from a template at creation
 * and belong to the order from then on: editing the template later must never
 * rewrite what a technician already ticked off.
 */
export function createChecklistRepository(db) {
  const insert = db.prepare(
    `INSERT INTO work_order_checklist_items (work_order_id, position, text) VALUES (?, ?, ?)`,
  );
  const listFor = db.prepare(
    `SELECT ${ITEM_COLUMNS} FROM work_order_checklist_items c
     LEFT JOIN users u ON u.id = c.done_by
     WHERE c.work_order_id = ? ORDER BY c.position, c.id`,
  );
  const byId = db.prepare(
    `SELECT ${ITEM_COLUMNS} FROM work_order_checklist_items c
     LEFT JOIN users u ON u.id = c.done_by WHERE c.id = ?`,
  );
  const nextPosition = db.prepare(
    `SELECT COALESCE(MAX(position), -1) + 1 AS next FROM work_order_checklist_items WHERE work_order_id = ?`,
  );
  const setDone = db.prepare(
    `UPDATE work_order_checklist_items
     SET is_done = ?, done_by = ?, done_at = ? WHERE id = ?`,
  );
  const setText = db.prepare(`UPDATE work_order_checklist_items SET text = ? WHERE id = ?`);
  const setPosition = db.prepare(`UPDATE work_order_checklist_items SET position = ? WHERE id = ?`);
  const orderedIds = db.prepare(
    `SELECT id FROM work_order_checklist_items WHERE work_order_id = ? ORDER BY position, id`,
  );
  const remove = db.prepare(`DELETE FROM work_order_checklist_items WHERE id = ?`);
  const progress = db.prepare(
    `SELECT COUNT(*) AS total, COALESCE(SUM(is_done), 0) AS done
     FROM work_order_checklist_items WHERE work_order_id = ?`,
  );

  const hydrate = (row) => (row ? { ...row, isDone: Boolean(row.isDone) } : null);

  return {
    listFor: (workOrderId) => listFor.all(workOrderId).map(hydrate),
    findById: (id) => hydrate(byId.get(id)),
    add(workOrderId, text) {
      const position = nextPosition.get(workOrderId).next;
      const result = insert.run(workOrderId, position, text);
      return hydrate(byId.get(Number(result.lastInsertRowid)));
    },
    /** Copies template text into the order, preserving order. */
    addMany(workOrderId, texts) {
      let position = nextPosition.get(workOrderId).next;
      for (const text of texts) insert.run(workOrderId, position++, text);
    },
    setDone(id, isDone, userId) {
      setDone.run(isDone ? 1 : 0, isDone ? userId : null, isDone ? new Date().toISOString() : null, id);
      return hydrate(byId.get(id));
    },
    /** Renames an item without disturbing its done-state. */
    updateText(id, text) {
      setText.run(text, id);
      return hydrate(byId.get(id));
    },
    /**
     * Moves an item to `position`, then renumbers the whole checklist densely
     * from zero inside one transaction so no two items ever share a slot even
     * under concurrent edits.
     */
    reorder(workOrderId, id, position) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const ids = orderedIds.all(workOrderId).map((row) => row.id).filter((rowId) => rowId !== id);
        const target = Math.max(0, Math.min(position, ids.length));
        ids.splice(target, 0, id);
        ids.forEach((rowId, index) => setPosition.run(index, rowId));
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return hydrate(byId.get(id));
    },
    remove: (id) => remove.run(id).changes > 0,
    progressFor: (workOrderId) => progress.get(workOrderId),
  };
}
