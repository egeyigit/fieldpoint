/**
 * Idle-timeout and sliding-expiry support on the sessions table:
 *   - last_seen_at records when the session was last exercised, for the idle
 *     timeout check. Legacy rows are backfilled to "now" so they get one fresh
 *     idle window rather than either being immediately killed or, worse,
 *     stamped with a future value that disables idle expiry entirely.
 *   - absolute_expires_at is the hard ceiling a sliding renewal can never push
 *     past. Legacy rows had no separate ceiling, so their current expires_at
 *     becomes their absolute cap; new writes populate it at insert time.
 */
export const migration005SessionActivity = {
  version: 5,
  name: 'session-activity',
  up(db) {
    const now = Date.now();
    db.exec('ALTER TABLE sessions ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT 0');
    db.exec('ALTER TABLE sessions ADD COLUMN absolute_expires_at INTEGER NOT NULL DEFAULT 0');
    db.prepare('UPDATE sessions SET last_seen_at = ? WHERE last_seen_at = 0').run(now);
    db.exec('UPDATE sessions SET absolute_expires_at = expires_at WHERE absolute_expires_at = 0');
  },
};
