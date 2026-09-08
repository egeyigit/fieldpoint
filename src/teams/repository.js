/**
 * Team membership lookups. A team is the tenant boundary: every site and work
 * order belongs to exactly one, and a request is scoped to the caller's team.
 * A user may belong to more than one team; `primaryTeamId` returns the earliest
 * joined one, which is the single team every user has today.
 */
export function createTeamRepository(db) {
  const membership = db.prepare(
    `SELECT team_id AS teamId FROM team_members WHERE user_id = ? ORDER BY created_at ASC, team_id ASC LIMIT 1`,
  );
  const isMember = db.prepare(
    `SELECT 1 FROM team_members WHERE user_id = ? AND team_id = ? LIMIT 1`,
  );
  const addMember = db.prepare(
    `INSERT OR IGNORE INTO team_members (team_id, user_id) VALUES (?, ?)`,
  );

  return {
    /** The caller's team id, or null if they belong to none. */
    primaryTeamId: (userId) => membership.get(userId)?.teamId ?? null,
    isMember: (userId, teamId) => isMember.get(userId, teamId) !== undefined,
    addMember: (teamId, userId) => addMember.run(teamId, userId),
  };
}
