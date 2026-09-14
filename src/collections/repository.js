const COLUMNS = `c.id, c.owner_id AS ownerId, c.name, c.description,
  c.share_token AS shareToken, c.created_at AS createdAt, c.updated_at AS updatedAt`;

export function createCollectionRepository(db) {
  const byId = db.prepare(`SELECT ${COLUMNS} FROM collections c WHERE c.id = ?`);
  const listForOwner = db.prepare(
    `SELECT ${COLUMNS}, COUNT(s.id) AS siteCount,
            CASE WHEN c.share_token IS NULL THEN 0 ELSE 1 END AS isShared
     FROM collections c
     LEFT JOIN collection_sites cs ON cs.collection_id = c.id
     LEFT JOIN sites s ON s.id = cs.site_id AND s.deleted_at IS NULL
     WHERE c.owner_id = ? GROUP BY c.id ORDER BY c.updated_at DESC, c.id DESC`,
  );
  const insert = db.prepare(
    `INSERT INTO collections (owner_id, name, description) VALUES (?, ?, ?)`,
  );
  const update = db.prepare(
    `UPDATE collections SET
       name = CASE WHEN ? THEN ? ELSE name END,
       description = CASE WHEN ? THEN ? ELSE description END,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`,
  );
  const remove = db.prepare(`DELETE FROM collections WHERE id = ?`);
  const sitesForCollection = db.prepare(
    `SELECT s.id, s.name, s.address, s.lat, s.lng, s.category, s.status,
            cs.pinned_at AS pinnedAt
     FROM collection_sites cs JOIN sites s ON s.id = cs.site_id
     WHERE cs.collection_id = ? AND s.deleted_at IS NULL
     ORDER BY cs.pinned_at DESC, s.id DESC`,
  );
  const pin = db.prepare(
    `INSERT OR IGNORE INTO collection_sites (collection_id, site_id, pinned_by) VALUES (?, ?, ?)`,
  );
  const unpin = db.prepare(`DELETE FROM collection_sites WHERE collection_id = ? AND site_id = ?`);
  const setShareToken = db.prepare(
    `UPDATE collections SET share_token = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ? AND share_token IS NULL`,
  );
  const clearShareToken = db.prepare(
    `UPDATE collections SET share_token = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`,
  );
  const publicByToken = db.prepare(
    `SELECT c.name, c.description, u.name AS ownerName
     FROM collections c JOIN users u ON u.id = c.owner_id WHERE c.share_token = ?`,
  );
  const publicSites = db.prepare(
    `SELECT s.id, s.name, s.address, s.lat, s.lng, s.category, s.status,
            cs.pinned_at AS pinnedAt
     FROM collections c
     JOIN collection_sites cs ON cs.collection_id = c.id
     JOIN sites s ON s.id = cs.site_id AND s.deleted_at IS NULL
     WHERE c.share_token = ? ORDER BY cs.pinned_at DESC, s.id DESC`,
  );

  return {
    findById: (id) => byId.get(id) ?? null,
    listForOwner: (ownerId) => listForOwner.all(ownerId).map(normalizeSummary),
    create(ownerId, data) {
      const result = insert.run(ownerId, data.name, data.description);
      return byId.get(result.lastInsertRowid);
    },
    update(id, data) {
      update.run(
        Number(data.name !== undefined), data.name ?? null,
        Number(data.description !== undefined), data.description ?? null,
        id,
      );
      return byId.get(id) ?? null;
    },
    remove: (id) => remove.run(id).changes > 0,
    sitesFor: (id) => sitesForCollection.all(id),
    pin: (collectionId, siteId, userId) => pin.run(collectionId, siteId, userId).changes > 0,
    unpin: (collectionId, siteId) => unpin.run(collectionId, siteId).changes > 0,
    setShareToken(id, token) {
      setShareToken.run(token, id);
      return byId.get(id) ?? null;
    },
    clearShareToken: (id) => clearShareToken.run(id).changes > 0,
    findPublicByToken(token) {
      const collection = publicByToken.get(token);
      return collection ? { ...collection, sites: publicSites.all(token) } : null;
    },
  };
}

function normalizeSummary(row) {
  return { ...row, isShared: Boolean(row.isShared) };
}
