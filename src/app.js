import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db/connection.js';
import { createSessionStore } from './auth/session.js';
import { attachUser } from './auth/middleware.js';
import { createAuthRouter } from './auth/routes.js';
import { createUserRepository } from './users/repository.js';
import { createUserRouter } from './users/routes.js';
import { createSiteRepository } from './sites/repository.js';
import { createSiteRouter } from './sites/routes.js';
import { createSiteCategoryRepository } from './site-categories/repository.js';
import { createSiteCategoryRouter } from './site-categories/routes.js';
import { createWorkOrderRepository } from './work-orders/repository.js';
import { createWorkOrderRouter } from './work-orders/routes.js';
import { requestLogger } from './middleware/logging.js';
import { originCheck } from './middleware/security.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';

const require = createRequire(import.meta.url);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PUBLIC_DIR = join(ROOT, 'public');
const LEAFLET_DIR = dirname(require.resolve('leaflet/package.json'));
const BODY_LIMIT = '64kb';
const API_WINDOW_MS = 60 * 1000;
const API_MAX_REQUESTS = 600;

/**
 * Builds the Express app. Returns { app, db, sessions } so tests can drive the
 * app with supertest and close the database afterwards.
 */
export function createApp(config) {
  const db = openDatabase(config.dbPath);
  const sessions = createSessionStore(db, { secret: config.sessionSecret, ttlMs: config.sessionTtlMs });
  const users = createUserRepository(db);
  const sites = createSiteRepository(db);
  const siteCategories = createSiteCategoryRepository(db);
  const workOrders = createWorkOrderRepository(db);
  const deps = { db, sessions, users, sites, siteCategories, workOrders, config };

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.isProduction ? 1 : false);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https://*.tile.openstreetmap.org'],
          connectSrc: ["'self'", 'https://nominatim.openstreetmap.org'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(express.json({ limit: BODY_LIMIT }));
  app.use(requestLogger({ enabled: !config.isTest }));

  // Liveness *and* readiness: a process that cannot reach its database is not
  // healthy, and both Docker and the deploy manifest gate on this route.
  app.get('/api/health', (_req, res) => {
    let database = 'ok';
    try {
      db.prepare('SELECT 1 AS ok').get();
    } catch (error) {
      database = 'error';
      console.error('[health] database check failed', error);
    }
    const healthy = database === 'ok';
    res.status(healthy ? 200 : 503).json({
      ok: healthy,
      service: 'fieldpoint',
      database,
      time: new Date().toISOString(),
    });
  });

  app.use(attachUser(sessions));

  app.use(
    '/api',
    rateLimit({
      windowMs: API_WINDOW_MS,
      limit: config.isTest ? 100000 : API_MAX_REQUESTS,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
    originCheck(config.allowedOrigins),
  );
  app.use('/api/auth', createAuthRouter(deps));
  app.use('/api/users', createUserRouter(deps));
  app.use('/api/sites', createSiteRouter(deps));
  app.use('/api/site-categories', createSiteCategoryRouter(deps));
  app.use('/api/work-orders', createWorkOrderRouter(deps));
  app.use('/api', notFoundHandler);

  app.use('/vendor/leaflet', express.static(join(LEAFLET_DIR, 'dist'), { immutable: true, maxAge: '7d' }));
  // max-age 0 + ETag: browsers revalidate on every load, so UI updates never go stale.
  app.use(express.static(PUBLIC_DIR, { extensions: ['html'], maxAge: 0, etag: true }));
  app.use(errorHandler);

  return { app, db, sessions };
}
