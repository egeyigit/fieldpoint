const COLUMNS = `v.id, v.site_id AS siteId, v.user_id AS userId, v.visited_at AS visitedAt,
  v.rating, v.note, v.created_at AS createdAt, v.updated_at AS updatedAt,
  u.name AS userName, s.name AS siteName`;
const FROM = `FROM site_visits v
  JOIN sites s ON s.id = v.site_id
  JOIN users u ON u.id = v.user_id`;

export function createVisitRepository(db) {
  const byId = db.prepare(`SELECT ${COLUMNS} ${FROM} WHERE v.id = ?`);
  const insert = db.prepare(
    `INSERT INTO site_visits (site_id, user_id, visited_at, rating, note) VALUES (?, ?, ?, ?, ?)`,
  );
  const listForSite = db.prepare(
    `SELECT ${COLUMNS} ${FROM}
     WHERE v.site_id = ? AND s.deleted_at IS NULL
     ORDER BY v.visited_at DESC, v.id DESC LIMIT ? OFFSET ?`,
  );
  const countForSite = db.prepare(
    `SELECT COUNT(*) AS total FROM site_visits v
     JOIN sites s ON s.id = v.site_id AND s.deleted_at IS NULL WHERE v.site_id = ?`,
  );
  const listForUser = db.prepare(
    `SELECT ${COLUMNS} ${FROM}
     WHERE v.user_id = ? AND s.deleted_at IS NULL AND (? IS NULL OR v.site_id = ?)
     ORDER BY v.visited_at DESC, v.id DESC LIMIT ? OFFSET ?`,
  );
  const countForUser = db.prepare(
    `SELECT COUNT(*) AS total FROM site_visits v
     JOIN sites s ON s.id = v.site_id
     WHERE v.user_id = ? AND s.deleted_at IS NULL AND (? IS NULL OR v.site_id = ?)`,
  );
  const update = db.prepare(
    `UPDATE site_visits SET
       visited_at = CASE WHEN ? THEN ? ELSE visited_at END,
       rating = CASE WHEN ? THEN ? ELSE rating END,
       note = CASE WHEN ? THEN ? ELSE note END,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`,
  );
  const remove = db.prepare(`DELETE FROM site_visits WHERE id = ?`);

  return {
    findById: (id) => byId.get(id) ?? null,
    create(siteId, userId, data) {
      const result = insert.run(siteId, userId, data.visitedAt, data.rating, data.note);
      return byId.get(result.lastInsertRowid);
    },
    listForSite(siteId, { limit, offset }) {
      return { rows: listForSite.all(siteId, limit, offset), total: countForSite.get(siteId).total };
    },
    listForUser(userId, { siteId = null, limit, offset }) {
      return {
        rows: listForUser.all(userId, siteId, siteId, limit, offset),
        total: countForUser.get(userId, siteId, siteId).total,
      };
    },
    update(id, data) {
      update.run(
        Number(data.visitedAt !== undefined), data.visitedAt ?? null,
        Number(data.rating !== undefined), data.rating ?? null,
        Number(data.note !== undefined), data.note ?? null,
        id,
      );
      return byId.get(id) ?? null;
    },
    remove: (id) => remove.run(id).changes > 0,
  };
}
