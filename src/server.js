import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { seedDemo } from './db/seed.js';
import { networkInterfaces } from 'node:os';

const SESSION_PURGE_INTERVAL_MS = 15 * 60 * 1000;
const OVERDUE_SWEEP_INTERVAL_MS = 15 * 60 * 1000;

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((iface) => iface && iface.family === 'IPv4' && !iface.internal)
    .map((iface) => iface.address);
}

async function main() {
  const config = loadConfig();
  const { app, db, sessions, notifications } = createApp(config);

  if (config.seedDemo) {
    const created = await seedDemo(db, { log: (line) => console.log(`[seed] ${line}`) });
    if (created.users.length === 0 && created.sites.length === 0) console.log('[seed] demo data already present');
  }

  const purgeTimer = setInterval(() => sessions.purgeExpired(), SESSION_PURGE_INTERVAL_MS);
  purgeTimer.unref();

  // Idempotent across restarts: a source_key makes a repeat sweep a no-op.
  notifications.sweepOverdue();
  const overdueTimer = setInterval(() => notifications.sweepOverdue(), OVERDUE_SWEEP_INTERVAL_MS);
  overdueTimer.unref();

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
    clearInterval(overdueTimer);
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
