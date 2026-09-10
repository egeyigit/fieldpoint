/**
 * Work orders: the unit of field work. Each one belongs to a site, carries a
 * lifecycle status and priority, and can be assigned to a user with a due date.
 * Comments give the crew a thread per order.
 */
const SQL = `
CREATE TABLE IF NOT EXISTS work_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'blocked', 'done', 'cancelled')),
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  due_date TEXT,
  completed_at TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_work_orders_site ON work_orders(site_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(status);
CREATE INDEX IF NOT EXISTS idx_work_orders_assigned ON work_orders(assigned_to);
CREATE INDEX IF NOT EXISTS idx_work_orders_due ON work_orders(due_date);

CREATE TABLE IF NOT EXISTS work_order_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id INTEGER NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_wo_comments_order ON work_order_comments(work_order_id);
`;

const DOWN_SQL = `
DROP TABLE IF EXISTS work_order_comments;
DROP TABLE IF EXISTS work_orders;
`;

export const migration003WorkOrders = {
  version: 3,
  name: 'work-orders',
  up(db) {
    db.exec(SQL);
  },
  down(db) {
    db.exec(DOWN_SQL);
  },
};
