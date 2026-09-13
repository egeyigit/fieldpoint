import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { LATEST_VERSION, MIGRATIONS } from './migrations/index.js';

const META_SQL = `CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`;

function ensureDirectory(dbPath) {
  if (dbPath === ':memory:') return;
  mkdirSync(dirname(dbPath), { recursive: true });
}

export function readVersion(db) {
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
  const pending = MIGRATIONS.filter((migration) => migration.version > current);
  for (const migration of pending) {
    db.exec('BEGIN');
    try {
      migration.up(db);
      writeVersion(db, migration.version);
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
