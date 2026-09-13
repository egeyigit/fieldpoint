import { boundingBox, haversineKm } from './geo.js';

const COLUMNS = `s.id, s.name, s.address, s.lat, s.lng, s.category, s.status, s.notes,
  s.assigned_to AS assignedTo, s.created_by AS createdBy, s.updated_by AS updatedBy,
  s.deleted_at AS deletedAt, s.created_at AS createdAt, s.updated_at AS updatedAt,
  cu.name AS createdByName, uu.name AS updatedByName, au.name AS assignedToName`;
const FROM = `FROM sites s
  LEFT JOIN users cu ON cu.id = s.created_by
  LEFT JOIN users uu ON uu.id = s.updated_by
  LEFT JOIN users au ON au.id = s.assigned_to`;

const UPDATABLE = ['name', 'address', 'lat', 'lng', 'category', 'status', 'notes', 'assignedTo'];
const COLUMN_BY_FIELD = { assignedTo: 'assigned_to' };
// Every sort ends in a unique column so rows written in the same millisecond
// keep a stable, repeatable order instead of an arbitrary one.
const ORDER_BY_SORT = {
  name: 's.name COLLATE NOCASE, s.id ASC',
  created: 's.created_at DESC, s.id DESC',
  updated: 's.updated_at DESC, s.id DESC',
};

export function createSiteRepository(db) {
  const byId = db.prepare(`SELECT ${COLUMNS} ${FROM} WHERE s.id = ?`);
  const insert = db.prepare(
    `INSERT INTO sites (name, address, lat, lng, category, status, notes, assigned_to, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const softDelete = db.prepare(
    `UPDATE sites SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), deleted_by = ?
     WHERE id = ? AND deleted_at IS NULL`,
  );
  const restore = db.prepare(
    `UPDATE sites SET deleted_at = NULL, deleted_by = NULL,
     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_by = ?
     WHERE id = ? AND deleted_at IS NOT NULL`,
  );
  const stats = db.prepare(
    `SELECT category, status, COUNT(*) AS count FROM sites WHERE deleted_at IS NULL
     GROUP BY category, status ORDER BY category, status`,
  );

  function buildFilter(filters) {
    const clauses = [];
    const params = [];
    if (!filters.includeDeleted) clauses.push('s.deleted_at IS NULL');
    if (filters.q) {
      clauses.push(`(s.name LIKE ? ESCAPE '\\' OR s.address LIKE ? ESCAPE '\\' OR s.notes LIKE ? ESCAPE '\\')`);
      const pattern = `%${escapeLike(filters.q)}%`;
      params.push(pattern, pattern, pattern);
    }
    if (filters.category) {
      clauses.push('s.category = ?');
      params.push(filters.category);
    }
    if (filters.status) {
      clauses.push('s.status = ?');
      params.push(filters.status);
    }
    if (filters.assignedTo !== undefined) {
      clauses.push('s.assigned_to = ?');
      params.push(filters.assignedTo);
    }
    if (filters.north !== undefined) {
      clauses.push('s.lat BETWEEN ? AND ? AND s.lng BETWEEN ? AND ?');
      params.push(
        Math.min(filters.south, filters.north),
        Math.max(filters.south, filters.north),
        Math.min(filters.west, filters.east),
        Math.max(filters.west, filters.east),
      );
    }
    if (filters.radiusKm !== undefined) {
      const box = boundingBox(filters.nearLat, filters.nearLng, filters.radiusKm);
      clauses.push('s.lat BETWEEN ? AND ?');
      params.push(box.minLat, box.maxLat);
      if (!box.spansAllLongitudes) {
        clauses.push('s.lng BETWEEN ? AND ?');
        params.push(box.minLng, box.maxLng);
      }
    }
    return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
  }

  /** Exact distance filter applied after the SQL bounding box narrows the set. */
  function applyRadius(rows, filters) {
    if (filters.radiusKm === undefined) return rows;
    return rows
      .map((row) => ({
        ...row,
        distanceKm: haversineKm(filters.nearLat, filters.nearLng, row.lat, row.lng),
      }))
      .filter((row) => row.distanceKm <= filters.radiusKm);
  }

  function sortRows(rows, sort) {
    if (sort !== 'distance') return rows;
    return [...rows].sort((left, right) => left.distanceKm - right.distanceKm);
  }

  return {
    findById: (id) => byId.get(id) ?? null,
    /** Visible (not soft-deleted) site, or null. */
    findVisibleById(id) {
      const site = byId.get(id);
      return site && site.deletedAt === null ? site : null;
    },
    list(filters) {
      const { where, params } = buildFilter(filters);
      const order = ORDER_BY_SORT[filters.sort] ?? ORDER_BY_SORT.name;
      // A radius query filters exact distances in JS, so paginate after that.
      if (filters.radiusKm !== undefined) {
        const all = sortRows(
          applyRadius(db.prepare(`SELECT ${COLUMNS} ${FROM} ${where} ORDER BY ${order}`).all(...params), filters),
          filters.sort,
        );
        return { rows: all.slice(filters.offset, filters.offset + filters.limit), total: all.length };
      }
      const rows = db
        .prepare(`SELECT ${COLUMNS} ${FROM} ${where} ORDER BY ${order} LIMIT ? OFFSET ?`)
        .all(...params, filters.limit, filters.offset);
      const { total } = db.prepare(`SELECT COUNT(*) AS total FROM sites s ${where}`).get(...params);
      return { rows, total };
    },
    /** Every matching row, no pagination — for exports. */
    listAll(filters) {
      const { where, params } = buildFilter(filters);
      const order = ORDER_BY_SORT[filters.sort] ?? ORDER_BY_SORT.name;
      const rows = db.prepare(`SELECT ${COLUMNS} ${FROM} ${where} ORDER BY ${order}`).all(...params);
      return sortRows(applyRadius(rows, filters), filters.sort);
    },
    create(data, userId) {
      const result = insert.run(
        data.name, data.address, data.lat, data.lng, data.category, data.status, data.notes,
        data.assignedTo ?? null, userId, userId,
      );
      return byId.get(result.lastInsertRowid);
    },
    update(id, data, userId) {
      const fields = UPDATABLE.filter((key) => data[key] !== undefined);
      if (fields.length === 0) return byId.get(id) ?? null;
      const assignments = fields.map((key) => `${COLUMN_BY_FIELD[key] ?? key} = ?`).join(', ');
      db.prepare(
        `UPDATE sites SET ${assignments}, updated_by = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
      ).run(...fields.map((key) => data[key]), userId, id);
      return byId.get(id) ?? null;
    },
    /** Visible sites whose name, address or notes match the term. */
    search(term) {
      const pattern = `%${escapeLike(term)}%`;
      return db
        .prepare(
          `SELECT ${COLUMNS} ${FROM}
           WHERE s.deleted_at IS NULL
             AND (s.name LIKE ? ESCAPE '\\' OR s.address LIKE ? ESCAPE '\\' OR s.notes LIKE ? ESCAPE '\\')
           ORDER BY s.name COLLATE NOCASE, s.id ASC`,
        )
        .all(pattern, pattern, pattern);
    },
    softDelete: (id, userId) => softDelete.run(userId, id).changes > 0,
    restore: (id, userId) => restore.run(userId, id).changes > 0,
    stats: () => stats.all(),
  };
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
