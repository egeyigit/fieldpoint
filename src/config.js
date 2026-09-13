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
 * Keep a generated secret next to the database so sessions survive restarts.
 * Falls back to an in-memory secret if the file is unwritable.
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
  if (provided) {
    console.warn(`[config] SESSION_SECRET shorter than ${MIN_SECRET_LENGTH} chars; ignoring it`);
  }
  // No usable secret was supplied. A generated one persisted beside the
  // database keeps sessions valid across restarts and never lands in an image
  // layer or the repository. Production says so loudly: an operator who meant
  // to set SESSION_SECRET should notice, and a demo boot still comes up.
  if (env.NODE_ENV === 'production') {
    console.warn(
      '[config] SESSION_SECRET is not set; using a generated secret persisted next to the database. ' +
        'Set SESSION_SECRET for any deployment that is not a demo.',
    );
  }
  return loadOrCreateDevSecret(dbPath);
}

/** Relative DB paths are anchored to the project root, not the process cwd. */
function resolveDbPath(dbPath) {
  if (dbPath === ':memory:' || isAbsolute(dbPath)) return dbPath;
  return resolve(PROJECT_ROOT, dbPath);
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
    sessionSecret: resolveSessionSecret(env, dbPath),
    sessionTtlMs: parseIntOr(env.SESSION_TTL_HOURS, DEFAULT_SESSION_TTL_HOURS) * 60 * 60 * 1000,
    allowedOrigins: parseOrigins(env.ALLOWED_ORIGINS),
    geocoderUrl: env.GEOCODER_URL?.trim() || 'https://nominatim.openstreetmap.org/search',
    seedDemo: env.SEED_DEMO === 'true',
  });
}
