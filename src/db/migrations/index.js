import { migration001Baseline } from './001-baseline.js';
import { migration002SiteOwnership } from './002-site-ownership.js';
import { migration003WorkOrders } from './003-work-orders.js';

/**
 * Ordered migration list. Each entry runs once, inside a transaction; the
 * highest applied version is recorded in `schema_meta` and every applied
 * migration is recorded in `schema_migrations`. A migration may declare an
 * optional `down(db)`; one that omits it is irreversible, and a rollback that
 * would cross it is refused rather than silently skipped. Never edit a
 * migration that has shipped — add a new one.
 */
export const MIGRATIONS = Object.freeze([
  migration001Baseline,
  migration002SiteOwnership,
  migration003WorkOrders,
]);

export const LATEST_VERSION = MIGRATIONS.at(-1).version;

/** Returns the migration with the given version, or undefined. */
export function migrationByVersion(version) {
  return MIGRATIONS.find((migration) => migration.version === version);
}
