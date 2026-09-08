/**
 * Tenant boundary. A team owns sites and work orders; a user belongs to one or
 * more teams through `team_members`. Existing single-workspace data is folded
 * into one default team so nobody is locked out on upgrade, and every current
 * user is made a member of it.
 *
 * `team_id` is added NOT NULL with a backfill: create the default team first,
 * add the column with a default of that team's id, then drop the default so new
 * rows must state their team explicitly.
 */
const UP = `
CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS team_members (
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);

INSERT INTO teams (id, name) VALUES (1, 'Default Team');
INSERT INTO team_members (team_id, user_id) SELECT 1, id FROM users;

ALTER TABLE sites ADD COLUMN team_id INTEGER NOT NULL REFERENCES teams(id) DEFAULT 1;
ALTER TABLE work_orders ADD COLUMN team_id INTEGER NOT NULL REFERENCES teams(id) DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_sites_team ON sites(team_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_team ON work_orders(team_id);
`;

const DOWN = `
DROP INDEX IF EXISTS idx_work_orders_team;
DROP INDEX IF EXISTS idx_sites_team;
ALTER TABLE work_orders DROP COLUMN team_id;
ALTER TABLE sites DROP COLUMN team_id;
DROP INDEX IF EXISTS idx_team_members_user;
DROP TABLE IF EXISTS team_members;
DROP TABLE IF EXISTS teams;
`;

export const migration004Teams = {
  version: 4,
  name: 'teams',
  up(db) {
    db.exec(UP);
  },
  down(db) {
    db.exec(DOWN);
  },
};
