import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { LATEST_VERSION, MIGRATIONS } from './migrations/index.js';

const META_SQL = `CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`;
const HISTORY_SQL = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
)`;

function ensureDirectory(dbPath) {
  if (dbPath === ':memory:') return;
  mkdirSync(dirname(dbPath), { recursive: true });
}

function readBareVersion(db) {
  const row = db.prepare(`SELECT value FROM schema_meta WHERE key = 'version'`).get();
  return row ? Number(row.value) : 0;
}

function writeVersion(db, version) {
  db.prepare(
    `INSERT INTO schema_meta (key, value) VALUES ('version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(String(version));
}

/**
 * Ensures the meta and history tables exist, then backfills the history table
 * from the bare `version` key for databases created before per-migration
 * records existed. A database stamped at version N is assumed to have run every
 * migration up to and including N in order.
 */
function ensureHistory(db) {
  db.exec(META_SQL);
  db.exec(HISTORY_SQL);
  const recorded = db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count;
  if (recorded > 0) return;
  const bare = readBareVersion(db);
  if (bare <= 0) return;
  const insert = db.prepare(
    `INSERT OR IGNORE INTO schema_migrations (version, name) VALUES (?, ?)`,
  );
  for (const migration of MIGRATIONS) {
    if (migration.version <= bare) insert.run(migration.version, migration.name);
  }
}

function recordApplied(db, migration) {
  db.prepare(
    `INSERT OR REPLACE INTO schema_migrations (version, name) VALUES (?, ?)`,
  ).run(migration.version, migration.name);
}

function recordReverted(db, version) {
  db.prepare(`DELETE FROM schema_migrations WHERE version = ?`).run(version);
}

function appliedVersions(db) {
  return db
    .prepare('SELECT version FROM schema_migrations ORDER BY version')
    .all()
    .map((row) => Number(row.version));
}

function currentVersion(db) {
  const versions = appliedVersions(db);
  return versions.length ? versions.at(-1) : 0;
}

/**
 * Returns each known migration alongside whether it has been applied and when.
 */
export function migrationStatus(db) {
  ensureHistory(db);
  const rows = db
    .prepare('SELECT version, applied_at FROM schema_migrations')
    .all();
  const applied = new Map(rows.map((row) => [Number(row.version), row.applied_at]));
  return MIGRATIONS.map((migration) => ({
    version: migration.version,
    name: migration.name,
    applied: applied.has(migration.version),
    appliedAt: applied.get(migration.version) ?? null,
    reversible: typeof migration.down === 'function',
  }));
}

/**
 * Applies every migration newer than the recorded schema version. Each one runs
 * inside its own transaction, so a failure leaves the database on the last good
 * version rather than half-migrated.
 */
export function runMigrations(db, { log = () => {} } = {}) {
  ensureHistory(db);
  const current = currentVersion(db);
  if (current > LATEST_VERSION) {
    throw new Error(`Database schema version ${current} is newer than supported ${LATEST_VERSION}`);
  }
  const done = new Set(appliedVersions(db));
  const pending = MIGRATIONS.filter((migration) => !done.has(migration.version));
  for (const migration of pending) {
    db.exec('BEGIN');
    try {
      migration.up(db);
      recordApplied(db, migration);
      writeVersion(db, migration.version);
      db.exec('COMMIT');
      log(`applied migration ${migration.version} (${migration.name})`);
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`migration ${migration.version} (${migration.name}) failed: ${error.message}`, { cause: error });
    }
  }
  return { from: current, to: currentVersion(db), applied: pending.length };
}

/**
 * Rolls migrations back until the recorded version is `targetVersion`, running
 * each `down` inside its own transaction. A migration that does not declare a
 * `down` is refused outright rather than silently skipped, leaving the database
 * on the last good version.
 */
export function rollbackMigrations(db, targetVersion, { log = () => {} } = {}) {
  ensureHistory(db);
  const target = Number(targetVersion);
  if (!Number.isInteger(target) || target < 0) {
    throw new Error(`invalid target version ${targetVersion}`);
  }
  const current = currentVersion(db);
  if (target > current) {
    throw new Error(`target version ${target} is above current version ${current}`);
  }
  const byVersion = new Map(MIGRATIONS.map((migration) => [migration.version, migration]));
  const toRevert = appliedVersions(db)
    .filter((version) => version > target)
    .sort((a, b) => b - a);
  let reverted = 0;
  for (const version of toRevert) {
    const migration = byVersion.get(version);
    if (!migration) {
      throw new Error(`applied migration ${version} is unknown to this build; cannot roll back`);
    }
    if (typeof migration.down !== 'function') {
      throw new Error(`migration ${version} (${migration.name}) is irreversible; refusing to roll back`);
    }
    db.exec('BEGIN');
    try {
      migration.down(db);
      recordReverted(db, version);
      writeVersion(db, currentVersion(db));
      db.exec('COMMIT');
      reverted += 1;
      log(`reverted migration ${version} (${migration.name})`);
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`rollback of migration ${version} (${migration.name}) failed: ${error.message}`, { cause: error });
    }
  }
  return { from: current, to: currentVersion(db), reverted };
}

/**
 * Opens (and migrates) the SQLite database. Returns a DatabaseSync instance.
 * Callers own closing it via `db.close()`.
 */
export function openDatabase(dbPath, options = {}) {
  ensureDirectory(dbPath);
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  runMigrations(db, options);
  return db;
}
