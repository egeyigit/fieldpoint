import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema.js';

function ensureDirectory(dbPath) {
  if (dbPath === ':memory:') return;
  mkdirSync(dirname(dbPath), { recursive: true });
}

function applySchema(db) {
  db.exec(SCHEMA_SQL);
  const current = db.prepare(`SELECT value FROM schema_meta WHERE key = 'version'`).get();
  if (!current) {
    db.prepare(`INSERT INTO schema_meta (key, value) VALUES ('version', ?)`).run(String(SCHEMA_VERSION));
    return;
  }
  const version = Number(current.value);
  if (version > SCHEMA_VERSION) {
    throw new Error(`Database schema version ${version} is newer than supported ${SCHEMA_VERSION}`);
  }
  if (version < 2) {
    // The FTS table and triggers are created by SCHEMA_SQL above; backfill existing rows.
    db.exec(`INSERT INTO sites_fts (rowid, name, address, notes) SELECT id, name, address, notes FROM sites`);
  }
  if (version < SCHEMA_VERSION) {
    db.prepare(`UPDATE schema_meta SET value = ? WHERE key = 'version'`).run(String(SCHEMA_VERSION));
  }
}

/**
 * Opens (and migrates) the SQLite database. Returns a DatabaseSync instance.
 * Callers own closing it via `db.close()`.
 */
export function openDatabase(dbPath) {
  ensureDirectory(dbPath);
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  applySchema(db);
  return db;
}
