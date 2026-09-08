import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/db/connection.js';
import { backupDatabase } from '../scripts/backup.js';
import { createUserRepository } from '../src/users/repository.js';
import { upsertAdmin } from '../src/db/seed.js';

describe('backup', () => {
  it('snapshots every committed row into the copy', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fieldpoint-backup-'));
    const source = join(dir, 'fieldpoint.db');
    const target = join(dir, 'snapshot.db');
    const db = openDatabase(source);
    try {
      await upsertAdmin(db, { email: 'admin@example.com', name: 'Ada', password: 'first-password-1' });
      await upsertAdmin(db, { email: 'latest@example.com', name: 'Late Comer', password: 'second-password-2' });
      backupDatabase(db, target);
    } finally {
      db.close();
    }

    const copy = openDatabase(target);
    try {
      const users = createUserRepository(copy);
      assert.equal(users.count(), 2);
      assert.ok(users.findByEmail('latest@example.com'), 'the most recently created user must be in the backup');
    } finally {
      copy.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses to overwrite an existing file without --force', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fieldpoint-backup-'));
    const source = join(dir, 'fieldpoint.db');
    const target = join(dir, 'snapshot.db');
    const db = openDatabase(source);
    try {
      backupDatabase(db, target);
      assert.throws(() => backupDatabase(db, target), /refusing to overwrite/);
      assert.doesNotThrow(() => backupDatabase(db, target, { force: true }));
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
