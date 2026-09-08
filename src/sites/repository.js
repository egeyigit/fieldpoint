const COLUMNS = `s.id, s.name, s.address, s.lat, s.lng, s.category, s.status, s.notes,
  s.created_by AS createdBy, s.updated_by AS updatedBy, s.created_at AS createdAt, s.updated_at AS updatedAt,
  cu.name AS createdByName, uu.name AS updatedByName`;
const FROM = `FROM sites s LEFT JOIN users cu ON cu.id = s.created_by LEFT JOIN users uu ON uu.id = s.updated_by`;

const UPDATABLE = ['name', 'address', 'lat', 'lng', 'category', 'status', 'notes'];

const EARTH_RADIUS_KM = 6371;

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance in kilometres between two lat/lng points. */
export function haversineKm(lat1, lng1, lat2, lng2) {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function createSiteRepository(db) {
  const byId = db.prepare(`SELECT ${COLUMNS} ${FROM} WHERE s.id = ?`);
  const insert = db.prepare(
    `INSERT INTO sites (name, address, lat, lng, category, status, notes, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const remove = db.prepare(`DELETE FROM sites WHERE id = ?`);
  const stats = db.prepare(
    `SELECT category, status, COUNT(*) AS count FROM sites GROUP BY category, status`,
  );

  function buildFilter({ q, category, status }) {
    const clauses = [];
    const params = [];
    if (q) {
      clauses.push(`(s.name LIKE ? ESCAPE '\\' OR s.address LIKE ? ESCAPE '\\' OR s.notes LIKE ? ESCAPE '\\')`);
      const pattern = `%${escapeLike(q)}%`;
      params.push(pattern, pattern, pattern);
    }
    if (category) {
      clauses.push(`s.category = ?`);
      params.push(category);
    }
    if (status) {
      clauses.push(`s.status = ?`);
      params.push(status);
    }
    return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
  }

  /** Bounding-box pre-filter clause for a lat/lng/radiusKm proximity search. */
  function proximityClause({ lat, lng, radiusKm }) {
    if (radiusKm === undefined || lat === undefined || lng === undefined) return null;
    const latDelta = radiusKm / 111.32;
    const cos = Math.cos(toRadians(lat));
    const lngDelta = cos === 0 ? 180 : radiusKm / (111.32 * Math.abs(cos));
    return {
      clause: `s.lat BETWEEN ? AND ? AND s.lng BETWEEN ? AND ?`,
      params: [lat - latDelta, lat + latDelta, lng - lngDelta, lng + lngDelta],
    };
  }

  /** Attaches distanceKm and keeps only rows inside radiusKm, nearest first. */
  function withinRadius(rows, { lat, lng, radiusKm }) {
    if (radiusKm === undefined || lat === undefined || lng === undefined) return rows;
    return rows
      .map((row) => ({ ...row, distanceKm: haversineKm(lat, lng, row.lat, row.lng) }))
      .filter((row) => row.distanceKm <= radiusKm)
      .sort((a, b) => a.distanceKm - b.distanceKm);
  }

  function buildWhere(filters) {
    const { where, params } = buildFilter(filters);
    const proximity = proximityClause(filters);
    if (!proximity) return { where, params };
    const clause = where ? `${where} AND ${proximity.clause}` : `WHERE ${proximity.clause}`;
    return { where: clause, params: [...params, ...proximity.params] };
  }

  return {
    findById: (id) => byId.get(id) ?? null,
    list(filters) {
      const { where, params } = buildWhere(filters);
      if (filters.radiusKm !== undefined) {
        const all = withinRadius(
          db.prepare(`SELECT ${COLUMNS} ${FROM} ${where}`).all(...params),
          filters,
        );
        return { rows: all.slice(filters.offset, filters.offset + filters.limit), total: all.length };
      }
      const rows = db
        .prepare(`SELECT ${COLUMNS} ${FROM} ${where} ORDER BY s.name COLLATE NOCASE LIMIT ? OFFSET ?`)
        .all(...params, filters.limit, filters.offset);
      const { total } = db.prepare(`SELECT COUNT(*) AS total FROM sites s ${where}`).get(...params);
      return { rows, total };
    },
    /** Every matching row, no pagination — for exports. */
    listAll(filters) {
      const { where, params } = buildWhere(filters);
      const rows = db.prepare(`SELECT ${COLUMNS} ${FROM} ${where} ORDER BY s.name COLLATE NOCASE`).all(...params);
      return filters.radiusKm !== undefined ? withinRadius(rows, filters) : rows;
    },
    create(data, userId) {
      const result = insert.run(
        data.name, data.address, data.lat, data.lng, data.category, data.status, data.notes, userId, userId,
      );
      return byId.get(result.lastInsertRowid);
    },
    update(id, data, userId) {
      const fields = UPDATABLE.filter((key) => data[key] !== undefined);
      if (fields.length === 0) return byId.get(id) ?? null;
      const assignments = fields.map((key) => `${key} = ?`).join(', ');
      db.prepare(
        `UPDATE sites SET ${assignments}, updated_by = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
      ).run(...fields.map((key) => data[key]), userId, id);
      return byId.get(id) ?? null;
    },
    remove: (id) => remove.run(id).changes > 0,
    stats: () => stats.all(),
  };
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
