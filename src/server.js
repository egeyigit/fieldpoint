import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { seedDemo } from './db/seed.js';
import { generateDueWorkOrders } from './maintenance/generator.js';
import { networkInterfaces } from 'node:os';

const SESSION_PURGE_INTERVAL_MS = 15 * 60 * 1000;
const MAINTENANCE_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((iface) => iface && iface.family === 'IPv4' && !iface.internal)
    .map((iface) => iface.address);
}

async function main() {
  const config = loadConfig();
  const { app, db, sessions, deps } = createApp(config);

  if (config.seedDemo) {
    const created = await seedDemo(db, { log: (line) => console.log(`[seed] ${line}`) });
    if (created.users.length === 0 && created.sites.length === 0) console.log('[seed] demo data already present');
  }

  const purgeTimer = setInterval(() => sessions.purgeExpired(), SESSION_PURGE_INTERVAL_MS);
  purgeTimer.unref();

  // Recurring maintenance. Idempotent, so the boot sweep plus the hourly one
  // cannot double-generate, and a machine that was off overnight catches up.
  const sweep = () => {
    try {
      const created = generateDueWorkOrders(db, deps);
      if (created.length > 0) console.log(`[maintenance] generated ${created.length} work order(s)`);
    } catch (error) {
      console.error('[maintenance] sweep failed', error);
    }
  };
  sweep();
  const maintenanceTimer = setInterval(sweep, MAINTENANCE_SWEEP_INTERVAL_MS);
  maintenanceTimer.unref();

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
    clearInterval(maintenanceTimer);
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
