import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { hashPassword, verifyPassword } from './password.js';
import { SESSION_COOKIE, cookieOptions } from './session.js';
import { requireAuth } from './middleware.js';
import { changePasswordSchema, loginSchema, registerSchema } from './schema.js';
import { validate } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';
import { recordAudit } from '../audit/log.js';

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 20;
// Per-account cap: an attacker rotating source IPs is still counted per email.
const ACCOUNT_WINDOW_MS = 15 * 60 * 1000;
const ACCOUNT_MAX_FAILURES = 10;

/**
 * In-memory failed-login tracker keyed by lowercased email. Entries hold the
 * timestamps of recent failures within the rolling window; once the count
 * reaches ACCOUNT_MAX_FAILURES the account is locked until the oldest failure
 * ages out of the window. Single-process only — a multi-process deployment
 * would need a shared store.
 */
function createLoginAttemptTracker() {
  const failures = new Map();
  const key = (email) => String(email ?? '').trim().toLowerCase();
  const recent = (list, now) => list.filter((ts) => now - ts < ACCOUNT_WINDOW_MS);
  return {
    isLocked(email, now = Date.now()) {
      const list = failures.get(key(email));
      if (!list) return false;
      return recent(list, now).length >= ACCOUNT_MAX_FAILURES;
    },
    /** Records a failure and returns true when this failure crosses the lock threshold. */
    recordFailure(email, now = Date.now()) {
      const k = key(email);
      const list = recent(failures.get(k) ?? [], now);
      list.push(now);
      failures.set(k, list);
      return list.length === ACCOUNT_MAX_FAILURES;
    },
    reset(email) {
      failures.delete(key(email));
    },
  };
}

export function createAuthRouter({ db, users, sessions, config }) {
  const router = Router();
  const cookie = cookieOptions(config);
  const loginAttempts = createLoginAttemptTracker();

  const loginLimiter = rateLimit({
    windowMs: LOGIN_WINDOW_MS,
    limit: config.isTest ? 1000 : LOGIN_MAX_ATTEMPTS,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { ok: false, error: 'Too many attempts, try again later' },
  });

  // First registered user becomes admin; afterwards only admins may add users.
  router.post('/register', loginLimiter, validate(registerSchema), async (req, res, next) => {
    try {
      const { email, name, password } = req.validated.body;
      // Cheap pre-checks so anonymous callers cannot burn scrypt time after bootstrap.
      if (users.count() > 0 && req.user?.role !== 'admin') {
        throw new HttpError(403, 'Only administrators can create accounts');
      }
      const passwordHash = await hashPassword(password);
      // Hash first, then decide + insert synchronously: node:sqlite is sync, so no
      // interleaving request can slip a second "first admin" in between.
      const isBootstrap = users.count() === 0;
      if (!isBootstrap && req.user?.role !== 'admin') {
        throw new HttpError(403, 'Only administrators can create accounts');
      }
      if (users.findByEmail(email)) throw new HttpError(409, 'Email already registered');
      const user = users.create({ email, name, passwordHash, role: isBootstrap ? 'admin' : 'member' });
      recordAudit(db, {
        userId: req.user?.id ?? user.id,
        action: 'user.create',
        entityType: 'user',
        entityId: user.id,
        details: { email, role: user.role, bootstrap: isBootstrap },
      });
      if (isBootstrap) {
        res.cookie(SESSION_COOKIE, sessions.create(user.id), cookie);
      }
      res.status(201).json({ ok: true, user });
    } catch (error) {
      next(error);
    }
  });

  router.post('/login', loginLimiter, validate(loginSchema), async (req, res, next) => {
    try {
      const { email, password } = req.validated.body;
      const user = users.findByEmail(email);
      // Always run the hash to keep timing uniform for unknown emails.
      const isValid = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
      // A locked account fails identically to a bad password so lockout cannot
      // be used to probe which emails exist.
      if (loginAttempts.isLocked(email) || !user || !isValid || !user.isActive) {
        recordAudit(db, { action: 'auth.login_failed', entityType: 'user', details: { email } });
        if (loginAttempts.recordFailure(email)) {
          recordAudit(db, { action: 'auth.lockout', entityType: 'user', details: { email } });
        }
        throw new HttpError(401, 'Invalid email or password');
      }
      loginAttempts.reset(email);
      res.cookie(SESSION_COOKIE, sessions.create(user.id), cookie);
      recordAudit(db, { userId: user.id, action: 'auth.login', entityType: 'user', entityId: user.id });
      res.json({ ok: true, user: publicUser(user) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/logout', (req, res) => {
    if (req.sessionToken) sessions.destroy(req.sessionToken);
    res.clearCookie(SESSION_COOKIE, { ...cookie, maxAge: undefined });
    res.json({ ok: true });
  });

  router.get('/me', (req, res) => {
    res.json({ ok: true, user: req.user, needsBootstrap: users.count() === 0 });
  });

  router.post('/password', requireAuth, validate(changePasswordSchema), async (req, res, next) => {
    try {
      const { currentPassword, newPassword } = req.validated.body;
      const user = users.findByEmail(req.user.email);
      if (!(await verifyPassword(currentPassword, user.passwordHash))) {
        throw new HttpError(401, 'Current password is incorrect');
      }
      users.updatePassword(user.id, await hashPassword(newPassword));
      sessions.destroyAllForUser(user.id);
      res.cookie(SESSION_COOKIE, sessions.create(user.id), cookie);
      recordAudit(db, { userId: user.id, action: 'auth.password_change', entityType: 'user', entityId: user.id });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

const DUMMY_HASH = 'scrypt1$00000000000000000000000000000000$' + '0'.repeat(128);

function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}
