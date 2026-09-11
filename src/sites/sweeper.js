import { recordAudit } from '../audit/log.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * ISO timestamp `days` days before `now`. Sites soft-deleted before this cutoff
 * are eligible for purge. Kept pure so the arithmetic can be tested directly.
 */
export function purgeCutoff(days, now = new Date()) {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

/**
 * Hard-delete every site soft-deleted before the retention cutoff. Cascades to
 * work orders and comments via foreign keys. Records one `site.purge` audit
 * entry per removed site (system action, no user). Returns the number purged.
 */
export function sweepDeletedSites(db, sites, { retentionDays, now = new Date() } = {}) {
  if (!(retentionDays > 0)) return 0;
  const cutoff = purgeCutoff(retentionDays, now);
  const doomed = db
    .prepare(`SELECT id, name FROM sites WHERE deleted_at IS NOT NULL AND deleted_at < ?`)
    .all(cutoff);
  if (doomed.length === 0) return 0;
  const purged = sites.purgeOlderThan(cutoff);
  for (const site of doomed) {
    recordAudit(db, {
      userId: null, action: 'site.purge', entityType: 'site', entityId: site.id,
      details: { name: site.name, reason: 'retention', retentionDays },
    });
  }
  return purged;
}
