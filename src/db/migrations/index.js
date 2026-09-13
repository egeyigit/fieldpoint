import { migration001Baseline } from './001-baseline.js';
import { migration002SiteOwnership } from './002-site-ownership.js';
import { migration003WorkOrders } from './003-work-orders.js';
import { migration004SiteCategories } from './004-site-categories.js';

/**
 * Ordered migration list. Each entry runs once, inside a transaction, and the
 * highest applied version is recorded in `schema_meta`. Never edit a migration
 * that has shipped — add a new one.
 */
export const MIGRATIONS = Object.freeze([
  migration001Baseline,
  migration002SiteOwnership,
  migration003WorkOrders,
  migration004SiteCategories,
]);

export const LATEST_VERSION = MIGRATIONS.at(-1).version;
