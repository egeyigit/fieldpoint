const COLUMNS = `s.id, s.name, s.address, s.lat, s.lng, s.category, s.status, s.notes,
  s.created_by AS createdBy, s.updated_by AS updatedBy, s.created_at AS createdAt, s.updated_at AS updatedAt,
  cu.name AS createdByName, uu.name AS updatedByName`;
const FROM = `FROM sites s LEFT JOIN users cu ON cu.id = s.created_by LEFT JOIN users uu ON uu.id = s.updated_by`;

const UPDATABLE = ['name', 'address', 'lat', 'lng', 'category', 'status', 'notes'];

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
      const match = toMatchQuery(q);
      if (match) {
        clauses.push(`s.id IN (SELECT rowid FROM sites_fts WHERE sites_fts MATCH ?)`);
        params.push(match);
      } else {
        clauses.push(`(s.name LIKE ? ESCAPE '\\' OR s.address LIKE ? ESCAPE '\\' OR s.notes LIKE ? ESCAPE '\\')`);
        const pattern = `%${escapeLike(q)}%`;
        params.push(pattern, pattern, pattern);
      }
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

  return {
    findById: (id) => byId.get(id) ?? null,
    list(filters) {
      const { where, params } = buildFilter(filters);
      const rows = db
        .prepare(`SELECT ${COLUMNS} ${FROM} ${where} ORDER BY s.name COLLATE NOCASE LIMIT ? OFFSET ?`)
        .all(...params, filters.limit, filters.offset);
      const { total } = db.prepare(`SELECT COUNT(*) AS total FROM sites s ${where}`).get(...params);
      return { rows, total };
    },
    /** Every matching row, no pagination — for exports. */
    listAll(filters) {
      const { where, params } = buildFilter(filters);
      return db.prepare(`SELECT ${COLUMNS} ${FROM} ${where} ORDER BY s.name COLLATE NOCASE`).all(...params);
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

/**
 * Builds a safe FTS5 MATCH query from user input, or null when the query is not
 * expressible as FTS5 tokens (so the caller falls back to LIKE). Each run of
 * word characters becomes a prefix term; anything else (punctuation, wildcards)
 * disqualifies the query from MATCH so LIKE semantics are preserved.
 */
function toMatchQuery(value) {
  const tokens = value.match(/[\p{L}\p{N}_]+/gu);
  if (!tokens || tokens.length === 0) return null;
  // Only use MATCH when the input is entirely word characters and whitespace,
  // otherwise LIKE substring semantics (e.g. '100%') would silently change.
  if (!/^[\p{L}\p{N}_\s]+$/u.test(value)) return null;
  return tokens.map((token) => `"${token}"*`).join(' ');
}
