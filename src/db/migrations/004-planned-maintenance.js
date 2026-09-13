/**
 * Planned maintenance: the work a team knows is coming.
 *
 * A template is a reusable recipe (title, priority, ordered checklist). A
 * schedule turns one into work orders on a cadence. A work order carries its
 * own copy of the checklist — copied, never referenced, so editing a template
 * can never rewrite the record of what a technician actually ticked off — and
 * time logs recording who worked on it and for how long.
 */
const SQL = `
CREATE TABLE IF NOT EXISTS work_order_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  estimated_minutes INTEGER CHECK (estimated_minutes IS NULL OR estimated_minutes > 0),
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_templates_name ON work_order_templates(name);
CREATE INDEX IF NOT EXISTS idx_templates_archived ON work_order_templates(is_archived);

CREATE TABLE IF NOT EXISTS work_order_template_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES work_order_templates(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_template_items_template ON work_order_template_items(template_id, position);

CREATE TABLE IF NOT EXISTS work_order_checklist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id INTEGER NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  text TEXT NOT NULL,
  is_done INTEGER NOT NULL DEFAULT 0,
  done_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  done_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_checklist_order ON work_order_checklist_items(work_order_id, position);

CREATE TABLE IF NOT EXISTS work_order_time_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id INTEGER NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_time_logs_order ON work_order_time_logs(work_order_id);
CREATE INDEX IF NOT EXISTS idx_time_logs_user ON work_order_time_logs(user_id);
-- One person can only be clocked in to one job at a time; a partial index makes
-- that a database rule rather than a hope.
CREATE UNIQUE INDEX IF NOT EXISTS idx_time_logs_open_per_user
  ON work_order_time_logs(user_id) WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS maintenance_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  template_id INTEGER REFERENCES work_order_templates(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  interval_days INTEGER NOT NULL CHECK (interval_days > 0),
  next_due_date TEXT NOT NULL,
  last_generated_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_schedules_site ON maintenance_schedules(site_id);
CREATE INDEX IF NOT EXISTS idx_schedules_due ON maintenance_schedules(next_due_date) WHERE is_active = 1;

ALTER TABLE work_orders ADD COLUMN template_id INTEGER REFERENCES work_order_templates(id) ON DELETE SET NULL;
ALTER TABLE work_orders ADD COLUMN schedule_id INTEGER REFERENCES maintenance_schedules(id) ON DELETE SET NULL;
ALTER TABLE work_orders ADD COLUMN estimated_minutes INTEGER;
CREATE INDEX IF NOT EXISTS idx_work_orders_schedule ON work_orders(schedule_id);
`;

export const migration004PlannedMaintenance = {
  version: 4,
  name: 'planned-maintenance',
  up(db) {
    db.exec(SQL);
  },
};
