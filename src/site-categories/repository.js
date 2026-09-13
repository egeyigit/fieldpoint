/** Data access for the configurable site-category list. */
export function createSiteCategoryRepository(db) {
  const COLUMNS = `id, slug, label, color, archived_at AS archivedAt,
    created_at AS createdAt, updated_at AS updatedAt`;
  const bySlug = db.prepare(`SELECT ${COLUMNS} FROM site_categories WHERE slug = ?`);
  const byId = db.prepare(`SELECT ${COLUMNS} FROM site_categories WHERE id = ?`);
  const insert = db.prepare(
    `INSERT INTO site_categories (slug, label, color) VALUES (?, ?, ?)`,
  );
  const archive = db.prepare(
    `UPDATE site_categories SET archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ? AND archived_at IS NULL`,
  );
  const unarchive = db.prepare(
    `UPDATE site_categories SET archived_at = NULL,
     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ? AND archived_at IS NOT NULL`,
  );

  return {
    /** Every category, archived or not — for the admin screen. */
    list() {
      return db
        .prepare(`SELECT ${COLUMNS} FROM site_categories ORDER BY label COLLATE NOCASE, id`)
        .all();
    },
    /** Only the categories the picker should offer. */
    listActive() {
      return db
        .prepare(
          `SELECT ${COLUMNS} FROM site_categories WHERE archived_at IS NULL
           ORDER BY label COLLATE NOCASE, id`,
        )
        .all();
    },
    findBySlug: (slug) => bySlug.get(slug) ?? null,
    findById: (id) => byId.get(id) ?? null,
    /** True if the slug exists at all (archived slugs stay valid on old sites). */
    exists: (slug) => bySlug.get(slug) !== undefined,
    /** True if the slug exists and is not archived (valid for new/changed sites). */
    isActive(slug) {
      const row = bySlug.get(slug);
      return Boolean(row) && row.archivedAt === null;
    },
    create(data) {
      const result = insert.run(data.slug, data.label, data.color);
      return byId.get(result.lastInsertRowid);
    },
    update(id, data) {
      const fields = ['label', 'color'].filter((key) => data[key] !== undefined);
      if (fields.length === 0) return byId.get(id) ?? null;
      const assignments = fields.map((key) => `${key} = ?`).join(', ');
      db.prepare(
        `UPDATE site_categories SET ${assignments}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
      ).run(...fields.map((key) => data[key]), id);
      return byId.get(id) ?? null;
    },
    archive: (id) => archive.run(id).changes > 0,
    unarchive: (id) => unarchive.run(id).changes > 0,
  };
}
