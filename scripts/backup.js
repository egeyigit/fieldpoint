/**
 * Writes a consistent snapshot of the SQLite database using `VACUUM INTO`.
 *
 * FieldPoint runs SQLite in WAL mode, so copying the `.db` file by hand while
 * the server is live captures only what has been checkpointed and silently
 * drops every commit still sitting in the `-wal` file. `VACUUM INTO` is the
 * one operation SQLite guarantees produces a complete, transactionally
 * consistent copy even under concurrent writes.
 *
 *   node scripts/backup.js [destination] [--force]
 *
 * Destination defaults to `<DB_PATH>.backup-<timestamp>.db`. The command
 * refuses to overwrite an existing file unless `--force` is given.
 */
import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db/connection.js';

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function parseArgs(argv) {
  const args = argv.filter((arg) => arg !== '--force');
  const force = argv.includes('--force');
  return { destination: args[0], force };
}

/**
 * Runs the backup. Exported so tests can drive it directly. Returns the
 * absolute path written.
 */
export function backupDatabase(db, destination, { force = false } = {}) {
  const target = isAbsolute(destination) ? destination : resolve(process.cwd(), destination);
  if (existsSync(target) && !force) {
    throw new Error(`refusing to overwrite existing file ${target} (pass --force to replace it)`);
  }
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  return target;
}

function main() {
  const { destination, force } = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  if (config.dbPath === ':memory:') {
    throw new Error('cannot back up an in-memory database');
  }
  const target = destination || `${config.dbPath}.backup-${timestamp()}.db`;
  const db = openDatabase(config.dbPath);
  try {
    const written = backupDatabase(db, target, { force });
    console.log(`backed up ${config.dbPath} -> ${written}`);
  } finally {
    db.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error('[backup] failed:', error.message);
    process.exit(1);
  }
}
