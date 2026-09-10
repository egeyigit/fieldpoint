/**
 * Migration operator CLI. Opens the configured database and reports or changes
 * its migration state.
 *
 *   node scripts/migrate.js status
 *   node scripts/migrate.js up
 *   node scripts/migrate.js down --to <version>
 *
 * `down` refuses to reverse a migration that declares itself irreversible
 * rather than silently skipping it.
 */
import { loadConfig } from '../src/config.js';
import {
  migrationStatus,
  openDatabase,
  rollbackMigrations,
  runMigrations,
} from '../src/db/connection.js';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--to') {
      options.to = rest[index + 1];
      index += 1;
    }
  }
  return { command, options };
}

function printStatus(db) {
  const rows = migrationStatus(db);
  for (const row of rows) {
    const mark = row.applied ? 'up  ' : 'down';
    const when = row.applied ? row.appliedAt : '-';
    const note = row.reversible ? '' : ' (irreversible)';
    console.log(`${mark} ${String(row.version).padStart(3, '0')} ${row.name} [${when}]${note}`);
  }
}

function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const db = openDatabase(config.dbPath);
  try {
    switch (command) {
      case 'status':
        printStatus(db);
        break;
      case 'up': {
        const result = runMigrations(db, { log: (line) => console.log(line) });
        console.log(`up: ${result.from} -> ${result.to} (${result.applied} applied)`);
        break;
      }
      case 'down': {
        if (options.to === undefined) throw new Error('down requires --to <version>');
        const result = rollbackMigrations(db, options.to, { log: (line) => console.log(line) });
        console.log(`down: ${result.from} -> ${result.to} (${result.reverted} reverted)`);
        break;
      }
      default:
        throw new Error(`unknown command '${command ?? ''}'; expected status | up | down --to <version>`);
    }
  } finally {
    db.close();
  }
}

try {
  main();
} catch (error) {
  console.error('[migrate] failed:', error.message);
  process.exit(1);
}
