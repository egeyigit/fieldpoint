/**
 * Append-only audit trail. Never throws on serialisation problems — an audit
 * failure must not mask the primary action, but it is logged loudly.
 */
export function recordAudit(db, { userId = null, action, entityType, entityId = null, details = {} }) {
  let serialised = '{}';
  try {
    serialised = JSON.stringify(details ?? {});
  } catch (error) {
    console.error('[audit] failed to serialise details', error);
  }
  db.prepare(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)`,
  ).run(userId, action, entityType, entityId, serialised);
}

export function listAudit(db, { limit = 100 } = {}) {
  return db
    .prepare(
      `SELECT a.id, a.user_id AS userId, u.email AS userEmail, a.action, a.entity_type AS entityType,
              a.entity_id AS entityId, a.details, a.created_at AS createdAt
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.id DESC LIMIT ?`,
    )
    .all(limit)
    .map((row) => ({ ...row, details: safeParse(row.details) }));
}

/**
 * Deletes audit rows older than `retentionDays` and writes a single
 * `audit.trim` entry describing the sweep. Entries inside the window are never
 * removed. Returns the number of rows deleted.
 */
export function trimAudit(db, { retentionDays, userId = null }) {
  const days = Number(retentionDays);
  if (!Number.isFinite(days) || days <= 0) return 0;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const info = db
    .prepare(`DELETE FROM audit_log WHERE created_at < ?`)
    .run(cutoff);
  const deleted = info.changes ?? 0;
  recordAudit(db, {
    userId,
    action: 'audit.trim',
    entityType: 'audit_log',
    entityId: null,
    details: { retentionDays: days, cutoff, deleted },
  });
  return deleted;
}

const CSV_HEADERS = ['id', 'userId', 'userEmail', 'action', 'entityType', 'entityId', 'details', 'createdAt'];

function escapeCsvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

/**
 * Streams the whole audit log as CSV to `res`, one row at a time, so a large
 * table is never buffered into a single string. Writes headers to the response
 * and ends it.
 */
export function streamAuditCsv(db, res) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="audit-log.csv"');
  res.write(`${CSV_HEADERS.join(',')}\r\n`);
  const statement = db.prepare(
    `SELECT a.id, a.user_id AS userId, u.email AS userEmail, a.action, a.entity_type AS entityType,
            a.entity_id AS entityId, a.details, a.created_at AS createdAt
     FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
     ORDER BY a.id ASC`,
  );
  for (const row of statement.iterate()) {
    const line = CSV_HEADERS.map((key) => escapeCsvCell(row[key])).join(',');
    res.write(`${line}\r\n`);
  }
  res.end();
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}
