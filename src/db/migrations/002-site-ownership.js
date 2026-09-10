/**
 * Sites gain an assignee and a soft-delete marker. Deleting a site now hides it
 * from every read path instead of destroying the row, so an accidental delete
 * can be undone.
 */
const SQL = `
ALTER TABLE sites ADD COLUMN assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE sites ADD COLUMN deleted_at TEXT;
ALTER TABLE sites ADD COLUMN deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sites_assigned ON sites(assigned_to);
CREATE INDEX IF NOT EXISTS idx_sites_deleted ON sites(deleted_at);
CREATE INDEX IF NOT EXISTS idx_sites_bbox ON sites(lat, lng);
`;

const DOWN_SQL = `
DROP INDEX IF EXISTS idx_sites_bbox;
DROP INDEX IF EXISTS idx_sites_deleted;
DROP INDEX IF EXISTS idx_sites_assigned;
ALTER TABLE sites DROP COLUMN deleted_by;
ALTER TABLE sites DROP COLUMN deleted_at;
ALTER TABLE sites DROP COLUMN assigned_to;
`;

export const migration002SiteOwnership = {
  version: 2,
  name: 'site-ownership-and-soft-delete',
  up(db) {
    db.exec(SQL);
  },
  down(db) {
    db.exec(DOWN_SQL);
  },
};
