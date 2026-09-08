import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const DEFAULT_PORT = 4100;
const DEFAULT_SESSION_TTL_HOURS = 72;
const MIN_SECRET_LENGTH = 32;

function parseIntOr(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const DEV_SECRET_FILE = '.session-secret';

/**
 * Development only: keep a generated secret next to the database so sessions
 * survive restarts. Falls back to an in-memory secret if the file is unwritable.
 */
function loadOrCreateDevSecret(dbPath) {
  if (dbPath === ':memory:') return randomBytes(32).toString('hex');
  const file = resolve(dirname(dbPath), DEV_SECRET_FILE);
  try {
    if (existsSync(file)) {
      const stored = readFileSync(file, 'utf8').trim();
      if (stored.length >= MIN_SECRET_LENGTH) return stored;
    }
    const generated = randomBytes(32).toString('hex');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, generated, { mode: 0o600 });
    return generated;
  } catch (error) {
    console.warn(`[config] could not persist dev session secret at ${file}: ${error.message}`);
    return randomBytes(32).toString('hex');
  }
}

function resolveSessionSecret(env, dbPath) {
  const provided = env.SESSION_SECRET?.trim();
  if (provided && provided.length >= MIN_SECRET_LENGTH) return provided;
  if (env.NODE_ENV === 'production') {
    throw new Error(
      `SESSION_SECRET must be set (>= ${MIN_SECRET_LENGTH} chars) when NODE_ENV=production`,
    );
  }
  if (provided) {
    console.warn(`[config] SESSION_SECRET shorter than ${MIN_SECRET_LENGTH} chars; ignoring it`);
  }
  return loadOrCreateDevSecret(dbPath);
}

/** Relative DB paths are anchored to the project root, not the process cwd. */
function resolveDbPath(dbPath) {
  if (dbPath === ':memory:' || isAbsolute(dbPath)) return dbPath;
  return resolve(PROJECT_ROOT, dbPath);
}

/**
 * Attachments live next to the database in a writable data directory. For an
 * in-memory database (tests) fall back to a temp directory under the project.
 */
function resolveUploadsDir(env, dbPath) {
  const provided = env.UPLOADS_DIR?.trim();
  if (provided) return isAbsolute(provided) ? provided : resolve(PROJECT_ROOT, provided);
  if (dbPath === ':memory:') return resolve(PROJECT_ROOT, 'data', 'uploads-test');
  return resolve(dirname(dbPath), 'uploads');
}

function parseOrigins(value) {
  if (!value) return [];
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const dbPath = resolveDbPath(env.DB_PATH?.trim() || './data/fieldpoint.db');
  return Object.freeze({
    nodeEnv,
    isProduction: nodeEnv === 'production',
    isTest: nodeEnv === 'test',
    port: parseIntOr(env.PORT, DEFAULT_PORT),
    host: env.HOST?.trim() || '0.0.0.0',
    dbPath,
    uploadsDir: resolveUploadsDir(env, dbPath),
    sessionSecret: resolveSessionSecret(env, dbPath),
    sessionTtlMs: parseIntOr(env.SESSION_TTL_HOURS, DEFAULT_SESSION_TTL_HOURS) * 60 * 60 * 1000,
    allowedOrigins: parseOrigins(env.ALLOWED_ORIGINS),
    seedDemo: env.SEED_DEMO === 'true',
  });
}
