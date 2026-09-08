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

export function createAuthRouter({ db, users, sessions, teams, config }) {
  const router = Router();
  const cookie = cookieOptions(config);

  // Every account belongs to the default team the teams migration seeds.
  const DEFAULT_TEAM_ID = 1;

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
      teams.addMember(DEFAULT_TEAM_ID, user.id);
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
      if (!user || !isValid || !user.isActive) {
        recordAudit(db, { action: 'auth.login_failed', entityType: 'user', details: { email } });
        throw new HttpError(401, 'Invalid email or password');
      }
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
