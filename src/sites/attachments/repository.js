import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { extensionFor } from './sniff.js';

const COLUMNS = `id, site_id AS siteId, filename, storage_name AS storageName,
  mime_type AS mimeType, size, uploaded_by AS uploadedBy, created_at AS createdAt`;

/**
 * Files are stored under uploadsDir keyed by a generated storage name; the
 * client filename is kept only for display and download and is never used as a
 * path. resolvePath() re-derives the absolute path from the stored basename so
 * a crafted storage name cannot escape the uploads directory.
 */
export function createAttachmentRepository(db, uploadsDir) {
  mkdirSync(uploadsDir, { recursive: true });

  const listForSite = db.prepare(
    `SELECT ${COLUMNS} FROM site_attachments WHERE site_id = ? ORDER BY created_at, id`,
  );
  const byId = db.prepare(`SELECT ${COLUMNS} FROM site_attachments WHERE id = ? AND site_id = ?`);
  const insert = db.prepare(
    `INSERT INTO site_attachments (site_id, filename, storage_name, mime_type, size, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const removeRow = db.prepare(`DELETE FROM site_attachments WHERE id = ?`);

  function resolvePath(storageName) {
    return join(uploadsDir, basename(storageName));
  }

  const byIdOnly = db.prepare(`SELECT ${COLUMNS} FROM site_attachments WHERE id = ?`);

  return {
    listForSite: (siteId) => listForSite.all(siteId),
    find: (id, siteId) => byId.get(id, siteId) ?? null,
    resolvePath,
    readFile(attachment) {
      return readFileSync(resolvePath(attachment.storageName));
    },
    create({ siteId, filename, mimeType, data, uploadedBy }) {
      const storageName = `${randomBytes(16).toString('hex')}.${extensionFor(mimeType)}`;
      writeFileSync(resolvePath(storageName), data);
      try {
        const result = insert.run(siteId, filename, storageName, mimeType, data.length, uploadedBy);
        return byIdOnly.get(result.lastInsertRowid);
      } catch (error) {
        rmSync(resolvePath(storageName), { force: true });
        throw error;
      }
    },
    remove(attachment) {
      removeRow.run(attachment.id);
      rmSync(resolvePath(attachment.storageName), { force: true });
    },
    /** Deletes every file for a site (rows are removed by ON DELETE CASCADE). */
    removeFilesForSite(siteId) {
      for (const attachment of listForSite.all(siteId)) {
        if (existsSync(resolvePath(attachment.storageName))) {
          rmSync(resolvePath(attachment.storageName), { force: true });
        }
      }
    },
  };
}
