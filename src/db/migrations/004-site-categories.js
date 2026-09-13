/**
 * Site categories become data instead of a hard-coded enum. We create a
 * `site_categories` table seeded with the six original built-ins, then rebuild
 * the `sites` table to drop the `category` CHECK constraint (SQLite cannot ALTER
 * a constraint away, so the table is recreated and its rows copied verbatim).
 * Validation now lives against this table; archived categories stay valid on
 * existing sites but disappear from the picker.
 */
const SEED = [
  { slug: 'office', label: 'Office', color: '#22c55e' },
  { slug: 'warehouse', label: 'Warehouse', color: '#f59e0b' },
  { slug: 'client', label: 'Client', color: '#60a5fa' },
  { slug: 'job_site', label: 'Job site', color: '#f472b6' },
  { slug: 'vehicle', label: 'Vehicle', color: '#a78bfa' },
  { slug: 'other', label: 'Other', color: '#8b98a8' },
];

const CREATE = `
CREATE TABLE IF NOT EXISTS site_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  color TEXT NOT NULL,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
`;

// Rebuild `sites` without the CHECK (category IN (...)) constraint. All other
// columns, defaults and indexes are reproduced exactly; rows are copied across.
const REBUILD_SITES = `
CREATE TABLE sites_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  lat REAL NOT NULL CHECK (lat >= -90 AND lat <= 90),
  lng REAL NOT NULL CHECK (lng >= -180 AND lng <= 180),
  category TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'planned')),
  notes TEXT NOT NULL DEFAULT '',
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TEXT,
  deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO sites_new (id, name, address, lat, lng, category, status, notes,
  assigned_to, created_by, updated_by, deleted_at, deleted_by, created_at, updated_at)
  SELECT id, name, address, lat, lng, category, status, notes,
    assigned_to, created_by, updated_by, deleted_at, deleted_by, created_at, updated_at
  FROM sites;
DROP TABLE sites;
ALTER TABLE sites_new RENAME TO sites;
CREATE INDEX IF NOT EXISTS idx_sites_category ON sites(category);
CREATE INDEX IF NOT EXISTS idx_sites_status ON sites(status);
`;

export const migration004SiteCategories = {
  version: 4,
  name: 'site-categories',
  up(db) {
    db.exec(CREATE);
    const insert = db.prepare(
      `INSERT OR IGNORE INTO site_categories (slug, label, color) VALUES (?, ?, ?)`,
    );
    for (const category of SEED) insert.run(category.slug, category.label, category.color);
    db.exec(REBUILD_SITES);
  },
};
