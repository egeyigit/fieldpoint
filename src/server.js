import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { seedDemo } from './db/seed.js';
import { sweepDeletedSites } from './sites/sweeper.js';
import { networkInterfaces } from 'node:os';

const SESSION_PURGE_INTERVAL_MS = 15 * 60 * 1000;
const SITE_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((iface) => iface && iface.family === 'IPv4' && !iface.internal)
    .map((iface) => iface.address);
}

async function main() {
  const config = loadConfig();
  const { app, db, sessions, sites } = createApp(config);

  if (config.seedDemo) {
    const created = await seedDemo(db, { log: (line) => console.log(`[seed] ${line}`) });
    if (created.users.length === 0 && created.sites.length === 0) console.log('[seed] demo data already present');
  }

  const purgeTimer = setInterval(() => sessions.purgeExpired(), SESSION_PURGE_INTERVAL_MS);
  purgeTimer.unref();

  // Recycle-bin drain: off unless SITE_PURGE_AFTER_DAYS is set. Sweep once on
  // boot, then on a timer.
  let sweepTimer = null;
  if (config.sitePurgeAfterDays) {
    const sweep = () => {
      try {
        const purged = sweepDeletedSites(db, sites, { retentionDays: config.sitePurgeAfterDays });
        if (purged > 0) console.log(`[sweeper] purged ${purged} site(s) past ${config.sitePurgeAfterDays}-day retention`);
      } catch (error) {
        console.error('[sweeper] site purge failed', error);
      }
    };
    sweep();
    sweepTimer = setInterval(sweep, SITE_SWEEP_INTERVAL_MS);
    sweepTimer.unref();
  }

  const server = app.listen(config.port, config.host, () => {
    console.log(`[fieldpoint] ${config.nodeEnv} · db=${config.dbPath}`);
    console.log(`[fieldpoint] local:   http://localhost:${config.port}`);
    for (const address of lanAddresses()) {
      console.log(`[fieldpoint] network: http://${address}:${config.port}`);
    }
  });

  const shutdown = (signal) => {
    console.log(`[fieldpoint] ${signal} received, shutting down`);
    clearInterval(purgeTimer);
    if (sweepTimer) clearInterval(sweepTimer);
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('[fieldpoint] failed to start', error);
  process.exit(1);
});
