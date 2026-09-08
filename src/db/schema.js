export const SCHEMA_VERSION = 2;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  lat REAL NOT NULL CHECK (lat >= -90 AND lat <= 90),
  lng REAL NOT NULL CHECK (lng >= -180 AND lng <= 180),
  category TEXT NOT NULL CHECK (category IN ('office', 'warehouse', 'client', 'job_site', 'vehicle', 'other')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'planned')),
  notes TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_sites_category ON sites(category);
CREATE INDEX IF NOT EXISTS idx_sites_status ON sites(status);

CREATE VIRTUAL TABLE IF NOT EXISTS sites_fts USING fts5(
  name, address, notes,
  content='sites', content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS sites_fts_insert AFTER INSERT ON sites BEGIN
  INSERT INTO sites_fts (rowid, name, address, notes) VALUES (new.id, new.name, new.address, new.notes);
END;
CREATE TRIGGER IF NOT EXISTS sites_fts_delete AFTER DELETE ON sites BEGIN
  INSERT INTO sites_fts (sites_fts, rowid, name, address, notes) VALUES ('delete', old.id, old.name, old.address, old.notes);
END;
CREATE TRIGGER IF NOT EXISTS sites_fts_update AFTER UPDATE ON sites BEGIN
  INSERT INTO sites_fts (sites_fts, rowid, name, address, notes) VALUES ('delete', old.id, old.name, old.address, old.notes);
  INSERT INTO sites_fts (rowid, name, address, notes) VALUES (new.id, new.name, new.address, new.notes);
END;

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  details TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
`;
