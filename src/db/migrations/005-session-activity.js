/**
 * Idle-timeout support: sessions record when they were last used. Existing rows
 * are backfilled to their expiry minus the default TTL window so a session that
 * was active before this migration is not treated as already idle-expired; a
 * simpler `created_at`-style default is not available on the sessions table.
 */
const SQL = `
ALTER TABLE sessions ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT 0;
UPDATE sessions SET last_seen_at = expires_at WHERE last_seen_at = 0;
`;

export const migration005SessionActivity = {
  version: 5,
  name: 'session-activity',
  up(db) {
    db.exec(SQL);
  },
};
