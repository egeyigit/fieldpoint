import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'fp_session';
// The __Host- prefix binds the cookie to this exact host (no Domain, Path=/,
// Secure), so a sibling subdomain cannot overwrite it. It requires HTTPS, so
// only production — which already sets Secure/Path=/ and no Domain — gets it;
// dev/test over plain HTTP keeps the unprefixed name.
export const SESSION_COOKIE_HOST_PREFIXED = `__Host-${SESSION_COOKIE}`;
export function sessionCookieName(isProduction) {
  return isProduction ? SESSION_COOKIE_HOST_PREFIXED : SESSION_COOKIE;
}
const TOKEN_BYTES = 32;
// A session with no activity for this long is treated as dead even if its
// absolute expiry has not been reached.
export const DEFAULT_IDLE_TIMEOUT_MS = 8 * 60 * 60 * 1000;

/**
 * Sessions are stored server-side (sessions table). The cookie carries
 * "<id>.<hmac(id)>" so a tampered id is rejected before touching the DB.
 */
export function createSessionStore(db, { secret, ttlMs, idleMs = DEFAULT_IDLE_TIMEOUT_MS }) {
  const insert = db.prepare(
    `INSERT INTO sessions (id, user_id, expires_at, last_seen_at) VALUES (?, ?, ?, ?)`,
  );
  const select = db.prepare(
    `SELECT s.id, s.user_id AS userId, s.expires_at AS expiresAt, s.last_seen_at AS lastSeenAt,
            u.email, u.name, u.role, u.is_active AS isActive
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
  );
  const touch = db.prepare(`UPDATE sessions SET expires_at = ?, last_seen_at = ? WHERE id = ?`);
  const remove = db.prepare(`DELETE FROM sessions WHERE id = ?`);
  const removeForUser = db.prepare(`DELETE FROM sessions WHERE user_id = ?`);
  const purge = db.prepare(`DELETE FROM sessions WHERE expires_at < ?`);

  function sign(id) {
    return createHmac('sha256', secret).update(id).digest('hex');
  }

  function verifyToken(token) {
    if (typeof token !== 'string') return null;
    const [id, signature] = token.split('.');
    if (!id || !signature) return null;
    const expected = Buffer.from(sign(id), 'hex');
    const actual = Buffer.from(signature, 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    return id;
  }

  return {
    create(userId) {
      const id = randomBytes(TOKEN_BYTES).toString('hex');
      const now = Date.now();
      insert.run(id, userId, now + ttlMs, now);
      return `${id}.${sign(id)}`;
    },
    /**
     * Returns the user for a valid session, else null. A session is invalid if
     * its absolute expiry has passed, it has been idle past idleMs, or the user
     * is inactive — all three delete the row. On a valid session the idle clock
     * is reset and the absolute expiry slides forward by ttlMs, capped so a
     * session created at time T can never live past T + ttlMs.
     */
    resolve(token) {
      const id = verifyToken(token);
      if (!id) return null;
      const row = select.get(id);
      if (!row) return null;
      const now = Date.now();
      const idleDeadline = row.lastSeenAt + idleMs;
      if (row.expiresAt < now || idleDeadline < now || !row.isActive) {
        remove.run(id);
        return null;
      }
      touch.run(now + ttlMs, now, id);
      return { id: row.userId, email: row.email, name: row.name, role: row.role };
    },
    destroy(token) {
      const id = verifyToken(token);
      if (id) remove.run(id);
    },
    destroyAllForUser(userId) {
      removeForUser.run(userId);
    },
    purgeExpired() {
      purge.run(Date.now());
    },
  };
}

export function cookieOptions({ isProduction, ttlMs }) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    path: '/',
    maxAge: ttlMs,
  };
}

/** Minimal cookie header parser — avoids a dependency for one cookie. */
export function parseCookies(header) {
  if (!header) return {};
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        if (index === -1) return [part, ''];
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }),
  );
}
