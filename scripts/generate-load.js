/**
 * Generates large-scale, geographically clustered load data for benchmarking
 * scale-dependent behaviour (pagination, search latency, radius queries,
 * map-marker density, N+1 joins). Inserts are batched inside transactions and
 * throughput is reported.
 *
 * Usage:
 *   node scripts/generate-load.js [--sites=50000] [--work-orders=200000]
 *                                 [--batch=1000] [--db=./data/load.db]
 *                                 [--seed=1] [--force]
 *
 * Refuses to write the configured DB_PATH (the app's real database) unless
 * --force is given, so it cannot clobber real data by accident. Point --db at a
 * throwaway file instead.
 */
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db/connection.js';
import { DEMO_USERS } from '../src/db/seed.js';
import { createUserRepository } from '../src/users/repository.js';
import { hashPassword } from '../src/auth/password.js';

const DEFAULTS = Object.freeze({
  sites: 50000,
  workOrders: 200000,
  batch: 1000,
  seed: 1,
});

/** Real metro centres so generated coordinates land on plausible landmasses. */
const CLUSTERS = Object.freeze([
  { name: 'New York', lat: 40.7128, lng: -74.006, weight: 12, spreadKm: 40 },
  { name: 'Los Angeles', lat: 34.0522, lng: -118.2437, weight: 9, spreadKm: 45 },
  { name: 'Chicago', lat: 41.8781, lng: -87.6298, weight: 7, spreadKm: 35 },
  { name: 'Houston', lat: 29.7604, lng: -95.3698, weight: 5, spreadKm: 40 },
  { name: 'Boston', lat: 42.3601, lng: -71.0589, weight: 5, spreadKm: 30 },
  { name: 'Atlanta', lat: 33.749, lng: -84.388, weight: 4, spreadKm: 35 },
  { name: 'Denver', lat: 39.7392, lng: -104.9903, weight: 3, spreadKm: 35 },
  { name: 'Seattle', lat: 47.6062, lng: -122.3321, weight: 3, spreadKm: 30 },
  { name: 'Miami', lat: 25.7617, lng: -80.1918, weight: 4, spreadKm: 30 },
  { name: 'London', lat: 51.5074, lng: -0.1278, weight: 6, spreadKm: 35 },
  { name: 'Berlin', lat: 52.52, lng: 13.405, weight: 4, spreadKm: 30 },
  { name: 'Toronto', lat: 43.6532, lng: -79.3832, weight: 3, spreadKm: 30 },
]);

const CATEGORIES = ['office', 'warehouse', 'client', 'job_site', 'vehicle', 'other'];
const SITE_STATUSES = ['active', 'active', 'active', 'planned', 'inactive'];
const WO_STATUSES = ['open', 'open', 'in_progress', 'blocked', 'done', 'cancelled'];
const WO_PRIORITIES = ['low', 'normal', 'normal', 'high', 'urgent'];
const KM_PER_DEGREE = 111;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Deterministic PRNG (mulberry32) so runs are reproducible via --seed. */
function makeRng(seed) {
  let state = seed >>> 0;
  return function next() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

function weightedCluster(rng) {
  const total = CLUSTERS.reduce((sum, c) => sum + c.weight, 0);
  let target = rng() * total;
  for (const cluster of CLUSTERS) {
    target -= cluster.weight;
    if (target <= 0) return cluster;
  }
  return CLUSTERS[CLUSTERS.length - 1];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** A point drawn from a cluster centre, denser near the centre. */
function scatter(rng, cluster) {
  const angle = rng() * Math.PI * 2;
  // Square-root pulls samples towards the centre: dense core, sparse edge.
  const distanceKm = Math.sqrt(rng()) * cluster.spreadKm;
  const latDelta = (distanceKm / KM_PER_DEGREE) * Math.sin(angle);
  const lngDelta =
    (distanceKm / (KM_PER_DEGREE * Math.cos((cluster.lat * Math.PI) / 180))) * Math.cos(angle);
  return {
    lat: clamp(cluster.lat + latDelta, -90, 90),
    lng: clamp(cluster.lng + lngDelta, -180, 180),
  };
}

function parseArgs(argv) {
  const options = { ...DEFAULTS, db: null, force: false };
  for (const arg of argv) {
    if (arg === '--force') {
      options.force = true;
    } else if (arg.startsWith('--sites=')) {
      options.sites = Number.parseInt(arg.slice(8), 10);
    } else if (arg.startsWith('--work-orders=')) {
      options.workOrders = Number.parseInt(arg.slice(14), 10);
    } else if (arg.startsWith('--batch=')) {
      options.batch = Number.parseInt(arg.slice(8), 10);
    } else if (arg.startsWith('--seed=')) {
      options.seed = Number.parseInt(arg.slice(7), 10);
    } else if (arg.startsWith('--db=')) {
      options.db = arg.slice(5);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  for (const key of ['sites', 'workOrders', 'batch', 'seed']) {
    if (!Number.isFinite(options[key]) || options[key] < 0) {
      throw new Error(`--${key} must be a non-negative integer`);
    }
  }
  if (options.batch < 1) throw new Error('--batch must be at least 1');
  return options;
}

async function ensureAuthor(db) {
  const users = createUserRepository(db);
  const existing = users.findByEmail(DEMO_USERS[0].email);
  if (existing) return existing.id;
  const row = users.create({
    ...DEMO_USERS[0],
    passwordHash: await hashPassword(DEMO_USERS[0].password),
  });
  return row.id;
}

/**
 * Runs `total` inserts in transactions of `batchSize`, calling `insertOne(index)`
 * for each row. Returns rows-per-second throughput.
 */
function runBatched(db, total, batchSize, insertOne, { log = () => {} } = {}) {
  const startedAt = Date.now();
  let done = 0;
  while (done < total) {
    const end = Math.min(done + batchSize, total);
    db.exec('BEGIN');
    try {
      for (let index = done; index < end; index += 1) insertOne(index);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    done = end;
    if (done % (batchSize * 10) === 0 || done === total) {
      const rate = Math.round(done / Math.max((Date.now() - startedAt) / 1000, 0.001));
      log(`  ${done}/${total} (${rate} rows/s)`);
    }
  }
  const seconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
  return { seconds, rate: Math.round(total / seconds) };
}

export async function generateLoad(db, options = {}, { log = () => {} } = {}) {
  const settings = { ...DEFAULTS, ...options };
  const rng = makeRng(settings.seed);
  const authorId = await ensureAuthor(db);

  const insertSite = db.prepare(
    `INSERT INTO sites (name, address, lat, lng, category, status, notes, created_by, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, '', ?, ?)`,
  );
  const siteIds = [];
  const sites = runBatched(
    db,
    settings.sites,
    settings.batch,
    (index) => {
      const cluster = weightedCluster(rng);
      const point = scatter(rng, cluster);
      const info = insertSite.run(
        `${cluster.name} Site ${index + 1}`,
        `${index + 1} Field Ave, ${cluster.name}`,
        point.lat,
        point.lng,
        pick(rng, CATEGORIES),
        pick(rng, SITE_STATUSES),
        authorId,
        authorId,
      );
      siteIds.push(Number(info.lastInsertRowid));
    },
    { log },
  );
  log(`sites: ${settings.sites} in ${sites.seconds.toFixed(1)}s (${sites.rate} rows/s)`);

  const insertWo = db.prepare(
    `INSERT INTO work_orders (site_id, title, description, status, priority, assigned_to, due_date, created_by, updated_by)
     VALUES (?, ?, '', ?, ?, ?, ?, ?, ?)`,
  );
  let workOrders = { seconds: 0, rate: 0 };
  if (siteIds.length > 0) {
    workOrders = runBatched(
      db,
      settings.workOrders,
      settings.batch,
      (index) => {
        const siteId = siteIds[Math.floor(rng() * siteIds.length)];
        const dueOffset = Math.floor(rng() * 60) - 20;
        const dueDate = new Date(Date.now() + dueOffset * DAY_MS).toISOString().slice(0, 10);
        insertWo.run(
          siteId,
          `Work order ${index + 1}`,
          pick(rng, WO_STATUSES),
          pick(rng, WO_PRIORITIES),
          authorId,
          dueDate,
          authorId,
          authorId,
        );
      },
      { log },
    );
    log(
      `work orders: ${settings.workOrders} in ${workOrders.seconds.toFixed(1)}s (${workOrders.rate} rows/s)`,
    );
  }

  return {
    sites: { count: settings.sites, seconds: sites.seconds, rate: sites.rate },
    workOrders: {
      count: siteIds.length > 0 ? settings.workOrders : 0,
      seconds: workOrders.seconds,
      rate: workOrders.rate,
    },
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const dbPath = options.db ?? config.dbPath;

  if (dbPath === config.dbPath && !options.force) {
    console.error(
      `[generate-load] refusing to write the configured DB_PATH (${config.dbPath}).\n` +
        '  Pass --db=./data/load.db to use a throwaway file, or --force to override.',
    );
    process.exit(1);
  }

  const db = openDatabase(dbPath);
  try {
    console.log(
      `[generate-load] ${options.sites} sites, ${options.workOrders} work orders → ${dbPath}`,
    );
    const result = await generateLoad(db, options, { log: console.log });
    console.log('done:', JSON.stringify(result));
  } finally {
    db.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('[generate-load] failed', error);
    process.exit(1);
  });
}
