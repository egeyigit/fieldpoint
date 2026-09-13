import { SESSION_COOKIE, SESSION_COOKIE_HOST_PREFIXED, parseCookies } from './session.js';
import { HttpError } from '../middleware/errors.js';

/**
 * Attaches req.user (or null) from the session cookie. Never rejects: a session
 * store failure is treated as "not signed in" (fail closed) and logged, so one
 * bad lookup cannot turn every route into a 500.
 */
export function attachUser(sessions) {
  return (req, _res, next) => {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[SESSION_COOKIE_HOST_PREFIXED] ?? cookies[SESSION_COOKIE];
    req.sessionToken = token ?? null;
    try {
      req.user = token ? sessions.resolve(token) : null;
    } catch (error) {
      console.error('[auth] session lookup failed; treating request as anonymous', error);
      req.user = null;
    }
    next();
  };
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Authentication required'));
  return next();
}

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'Authentication required'));
    if (!roles.includes(req.user.role)) return next(new HttpError(403, 'Insufficient permissions'));
    return next();
  };
}
