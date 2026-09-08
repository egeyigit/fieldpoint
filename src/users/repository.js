const PUBLIC_COLUMNS = `id, email, name, role, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt`;

export function createUserRepository(db) {
  const statements = {
    byEmail: db.prepare(`SELECT id, email, name, role, password_hash AS passwordHash, is_active AS isActive FROM users WHERE email = ?`),
    byId: db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ?`),
    count: db.prepare(`SELECT COUNT(*) AS count FROM users`),
    countAdmins: db.prepare(`SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND is_active = 1`),
    insert: db.prepare(`INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)`),
    list: db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM users ORDER BY created_at ASC`),
    directory: db.prepare(
      `SELECT id, name, role FROM users WHERE is_active = 1 ORDER BY name COLLATE NOCASE, id`,
    ),
    update: db.prepare(
      `UPDATE users SET role = COALESCE(?, role), is_active = COALESCE(?, is_active),
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
    ),
    updatePassword: db.prepare(
      `UPDATE users SET password_hash = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
    ),
  };

  return {
    findByEmail: (email) => statements.byEmail.get(email.toLowerCase()) ?? null,
    findById: (id) => statements.byId.get(id) ?? null,
    count: () => statements.count.get().count,
    countActiveAdmins: () => statements.countAdmins.get().count,
    list: () => statements.list.all(),
    /** Active users only, safe for any signed-in member to see (id, name, role — no email, timestamps, or hashes). */
    directory: () => statements.directory.all(),
    create({ email, name, passwordHash, role }) {
      const result = statements.insert.run(email.toLowerCase(), name, passwordHash, role);
      return statements.byId.get(result.lastInsertRowid);
    },
    update(id, { role = null, isActive = null }) {
      const active = isActive === null ? null : isActive ? 1 : 0;
      statements.update.run(role, active, id);
      return statements.byId.get(id) ?? null;
    },
    updatePassword(id, passwordHash) {
      statements.updatePassword.run(passwordHash, id);
    },
  };
}
