import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { LATEST_VERSION, MIGRATIONS } from '../src/db/migrations/index.js';
import { migrationStatus, openDatabase, rollbackMigrations, runMigrations } from '../src/db/connection.js';

const tableNames = (db) =>
  db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all().map((row) => row.name);

describe('migrations', () => {
  it('are numbered from 1 with no gaps or duplicates', () => {
    const versions = MIGRATIONS.map((migration) => migration.version);
    assert.deepEqual(versions, Array.from({ length: versions.length }, (_, index) => index + 1));
    assert.equal(new Set(MIGRATIONS.map((migration) => migration.name)).size, MIGRATIONS.length);
  });

  it('build every table on a fresh database', () => {
    const db = openDatabase(':memory:');
    try {
      for (const table of ['users', 'sessions', 'sites', 'audit_log', 'work_orders', 'work_order_comments']) {
        assert.ok(tableNames(db).includes(table), `missing ${table}`);
      }
      const version = db.prepare(`SELECT value FROM schema_meta WHERE key = 'version'`).get().value;
      assert.equal(Number(version), LATEST_VERSION);
      // Every migration is recorded individually in the history table.
      const recorded = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row) => Number(row.version));
      assert.deepEqual(recorded, MIGRATIONS.map((migration) => migration.version));
    } finally {
      db.close();
    }
  });

  it('backfills schema_migrations from a bare version key', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec('CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
      MIGRATIONS[0].up(db);
      MIGRATIONS[1].up(db);
      db.prepare(`INSERT INTO schema_meta (key, value) VALUES ('version', '2')`).run();

      const status = migrationStatus(db);
      assert.deepEqual(
        status.filter((row) => row.applied).map((row) => row.version),
        [1, 2],
      );
      // The pending migration is applied on top without re-running the first two.
      const result = runMigrations(db);
      assert.equal(result.from, 2);
      assert.equal(result.to, LATEST_VERSION);
      assert.equal(result.applied, MIGRATIONS.length - 2);
    } finally {
      db.close();
    }
  });

  it('rolls a database back to an earlier version', () => {
    const db = openDatabase(':memory:');
    try {
      const result = rollbackMigrations(db, 1);
      assert.equal(result.from, LATEST_VERSION);
      assert.equal(result.to, 1);
      assert.equal(result.reverted, MIGRATIONS.length - 1);
      assert.ok(!tableNames(db).includes('work_orders'), 'reverted table must be gone');
      const version = db.prepare(`SELECT value FROM schema_meta WHERE key = 'version'`).get().value;
      assert.equal(Number(version), 1);
      // Re-applying brings it back up to head.
      const back = runMigrations(db);
      assert.equal(back.to, LATEST_VERSION);
      assert.ok(tableNames(db).includes('work_orders'));
    } finally {
      db.close();
    }
  });

  it('refuses to roll back a migration that declares itself irreversible', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec('CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
      db.exec(`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT '')`);
      MIGRATIONS[0].up(db);
      db.prepare(`INSERT INTO schema_migrations (version, name, applied_at) VALUES (1, 'baseline', 'x')`).run();
      // A phantom applied migration with no down() must be refused, not skipped.
      db.prepare(`INSERT INTO schema_migrations (version, name, applied_at) VALUES (99, 'phantom', 'x')`).run();
      db.prepare(`INSERT INTO schema_meta (key, value) VALUES ('version', '99')`).run();
      assert.throws(() => rollbackMigrations(db, 1), /unknown to this build|irreversible/);
    } finally {
      db.close();
    }
  });

  it('are idempotent: a second run applies nothing', () => {
    const db = openDatabase(':memory:');
    try {
      const result = runMigrations(db);
      assert.equal(result.applied, 0);
      assert.equal(result.from, LATEST_VERSION);
    } finally {
      db.close();
    }
  });

  it('upgrade a database stopped at an older version, keeping its rows', () => {
    const db = new DatabaseSync(':memory:');
    try {
      // Simulate a v1 database: baseline only, version stamped at 1.
      db.exec('CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
      MIGRATIONS[0].up(db);
      db.prepare(`INSERT INTO schema_meta (key, value) VALUES ('version', '1')`).run();
      db.prepare(`INSERT INTO users (email, name, password_hash, role) VALUES ('a@b.c', 'A', 'x', 'admin')`).run();
      db.prepare(
        `INSERT INTO sites (name, lat, lng, category) VALUES ('Kept', 1.0, 2.0, 'office')`,
      ).run();

      const result = runMigrations(db);
      assert.equal(result.from, 1);
      assert.equal(result.to, LATEST_VERSION);
      assert.equal(result.applied, MIGRATIONS.length - 1);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM sites').get().count, 1);
      assert.equal(db.prepare('SELECT name FROM sites').get().name, 'Kept');
      assert.ok(tableNames(db).includes('work_orders'));
      // New columns exist and default to NULL on pre-existing rows.
      const site = db.prepare('SELECT assigned_to, deleted_at FROM sites').get();
      assert.equal(site.assigned_to, null);
      assert.equal(site.deleted_at, null);
    } finally {
      db.close();
    }
  });

  it('refuses to open a database from the future', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec('CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
      db.prepare(`INSERT INTO schema_meta (key, value) VALUES ('version', '999')`).run();
      assert.throws(() => runMigrations(db), /newer than supported/);
    } finally {
      db.close();
    }
  });

  it('rolls back and reports which migration failed', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec('CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
      const broken = [{ version: 1, name: 'broken', up: (handle) => handle.exec('CREATE TABLE nope (x); SELECT bad_function();') }];
      assert.throws(
        () => {
          for (const migration of broken) {
            db.exec('BEGIN');
            try {
              migration.up(db);
              db.exec('COMMIT');
            } catch (error) {
              db.exec('ROLLBACK');
              throw new Error(`migration ${migration.version} (${migration.name}) failed: ${error.message}`);
            }
          }
        },
        /migration 1 \(broken\) failed/,
      );
      assert.ok(!tableNames(db).includes('nope'), 'partial migration must roll back');
    } finally {
      db.close();
    }
  });
});
