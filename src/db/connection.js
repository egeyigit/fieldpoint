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

function readVersion(db) {
  const row = db.prepare(`SELECT value FROM schema_meta WHERE key = 'version'`).get();
  return row ? Number(row.value) : 0;
}

function writeVersion(db, version) {
  db.prepare(
    `INSERT INTO schema_meta (key, value) VALUES ('version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(String(version));
}

function recordApplied(db, migration) {
  db.prepare(
    `INSERT INTO schema_migrations (version, name) VALUES (?, ?)
     ON CONFLICT(version) DO UPDATE SET name = excluded.name`,
  ).run(migration.version, migration.name);
}

function forgetApplied(db, version) {
  db.prepare(`DELETE FROM schema_migrations WHERE version = ?`).run(version);
}

/**
 * Ensures the history table exists and, for a database that predates it, seeds
 * one row per migration up to the recorded `version`. Older field databases
 * carried nothing but the single `version` key; this reconstructs the visible
 * record without pretending to know the original applied_at.
 */
function ensureHistory(db, current) {
  db.exec(HISTORY_SQL);
  const known = db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count;
  if (known > 0 || current === 0) return;
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) recordApplied(db, migration);
  }
}

/** Returns the applied migration history, oldest first. */
export function migrationHistory(db) {
  db.exec(META_SQL);
  const current = readVersion(db);
  ensureHistory(db, current);
  return db
    .prepare('SELECT version, name, applied_at FROM schema_migrations ORDER BY version')
    .all();
}

/**
 * Applies every migration newer than the recorded schema version. Each one runs
 * inside its own transaction, so a failure leaves the database on the last good
 * version rather than half-migrated.
 */
export function runMigrations(db, { log = () => {} } = {}) {
  db.exec(META_SQL);
  const current = readVersion(db);
  if (current > LATEST_VERSION) {
    throw new Error(`Database schema version ${current} is newer than supported ${LATEST_VERSION}`);
  }
  ensureHistory(db, current);
  const pending = MIGRATIONS.filter((migration) => migration.version > current);
  for (const migration of pending) {
    db.exec('BEGIN');
    try {
      migration.up(db);
      writeVersion(db, migration.version);
      recordApplied(db, migration);
      db.exec('COMMIT');
      log(`applied migration ${migration.version} (${migration.name})`);
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`migration ${migration.version} (${migration.name}) failed: ${error.message}`, { cause: error });
    }
  }
  return { from: current, to: LATEST_VERSION, applied: pending.length };
}

/**
 * Rolls the database back to `targetVersion`, reversing each migration above it
 * newest-first inside its own transaction. A migration that declares no `down`
 * is irreversible: the rollback is refused before anything is undone rather
 * than silently skipping it, so the database is never left in an in-between
 * state. `targetVersion` must be between 0 and the current version.
 */
export function rollbackMigrations(db, targetVersion, { log = () => {} } = {}) {
  db.exec(META_SQL);
  const current = readVersion(db);
  ensureHistory(db, current);
  if (!Number.isInteger(targetVersion) || targetVersion < 0) {
    throw new Error(`invalid target version ${targetVersion}`);
  }
  if (targetVersion > current) {
    throw new Error(`target version ${targetVersion} is above current version ${current}`);
  }
  const toReverse = MIGRATIONS.filter(
    (migration) => migration.version > targetVersion && migration.version <= current,
  ).reverse();
  const irreversible = toReverse.find((migration) => typeof migration.down !== 'function');
  if (irreversible) {
    throw new Error(
      `migration ${irreversible.version} (${irreversible.name}) is irreversible: it declares no down()`,
    );
  }
  for (const migration of toReverse) {
    db.exec('BEGIN');
    try {
      migration.down(db);
      writeVersion(db, migration.version - 1);
      forgetApplied(db, migration.version);
      db.exec('COMMIT');
      log(`reverted migration ${migration.version} (${migration.name})`);
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`rollback of migration ${migration.version} (${migration.name}) failed: ${error.message}`, { cause: error });
    }
  }
  return { from: current, to: targetVersion, reverted: toReverse.length };
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
