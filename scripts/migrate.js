/**
 * Migration CLI for the DB_PATH database.
 *   npm run migrate status
 *   npm run migrate up
 *   npm run migrate down --to <version>
 *
 * `status` prints the current version and the applied history; `up` applies
 * every pending migration; `down --to <version>` reverses migrations back to
 * the given version, refusing outright if any migration in the way is
 * irreversible (declares no down()).
 */
import { loadConfig } from '../src/config.js';
import { openDatabase, runMigrations, rollbackMigrations, migrationHistory } from '../src/db/connection.js';
import { LATEST_VERSION } from '../src/db/migrations/index.js';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === '--to') {
      flags.to = rest[i + 1];
      i += 1;
    }
  }
  return { command, flags };
}

function printStatus(db) {
  const history = migrationHistory(db);
  const current = history.length ? history.at(-1).version : 0;
  console.log(`current version: ${current} (latest available: ${LATEST_VERSION})`);
  if (history.length === 0) {
    console.log('no migrations applied');
    return;
  }
  console.log('applied migrations:');
  for (const row of history) {
    console.log(`  ${row.version}  ${row.name}  ${row.applied_at}`);
  }
}

function main() {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const db = openDatabase(config.dbPath);
  try {
    switch (command) {
      case 'status':
        printStatus(db);
        break;
      case 'up': {
        const result = runMigrations(db, { log: console.log });
        console.log(`up: ${result.from} → ${result.to} (${result.applied} applied)`);
        break;
      }
      case 'down': {
        if (flags.to === undefined) throw new Error('down requires --to <version>');
        const target = Number(flags.to);
        if (!Number.isInteger(target)) throw new Error(`--to must be an integer, got ${flags.to}`);
        const result = rollbackMigrations(db, target, { log: console.log });
        console.log(`down: ${result.from} → ${result.to} (${result.reverted} reverted)`);
        break;
      }
      default:
        console.error('usage: migrate <status|up|down --to <version>>');
        process.exitCode = 1;
    }
  } finally {
    db.close();
  }
}

try {
  main();
} catch (error) {
  console.error(`[migrate] ${error.message}`);
  process.exit(1);
}
