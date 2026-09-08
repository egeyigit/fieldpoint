import { Router } from 'express';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { validate } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';
import { recordAudit } from '../audit/log.js';
import { z } from 'zod';
import { createSiteSchema, listSitesSchema, siteIdSchema, updateSiteSchema } from './schema.js';
import { toCsv } from './csv.js';

const includeDeletedSchema = z.object({
  includeDeleted: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .default(false),
});

export function createSiteRouter({ db, sites, users, teams }) {
  const router = Router();
  router.use(requireAuth);

  /** The caller's team, or a 403 if they belong to none. */
  function callerTeam(req) {
    const teamId = teams.primaryTeamId(req.user.id);
    if (teamId === null) throw new HttpError(403, 'You do not belong to a team');
    return teamId;
  }

  /** Rejects an assignee that does not exist or is deactivated. */
  function assertAssignable(assignedTo) {
    if (assignedTo === undefined || assignedTo === null) return;
    const user = users.findById(assignedTo);
    if (!user) throw new HttpError(400, 'Assigned user does not exist', [{ path: 'assignedTo', message: 'Unknown user' }]);
    if (!user.isActive) {
      throw new HttpError(400, 'Assigned user is deactivated', [{ path: 'assignedTo', message: 'User is not active' }]);
    }
  }

  /** Only admins may look at the recycle bin. */
  function assertMayIncludeDeleted(req) {
    if (req.validated.query.includeDeleted && req.user.role !== 'admin') {
      throw new HttpError(403, 'Only administrators can list deleted sites');
    }
  }

  router.get('/', validate(listSitesSchema, 'query'), (req, res, next) => {
    try {
      assertMayIncludeDeleted(req);
      const query = req.validated.query;
      const { rows, total } = sites.list(query, callerTeam(req));
      return res.json({ ok: true, sites: rows, total, limit: query.limit, offset: query.offset });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/stats', (req, res, next) => {
    try {
      res.json({ ok: true, stats: sites.stats(callerTeam(req)) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/export.csv', validate(listSitesSchema, 'query'), (req, res, next) => {
    let rows;
    try {
      assertMayIncludeDeleted(req);
      rows = sites.listAll(req.validated.query, callerTeam(req));
    } catch (error) {
      return next(error);
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="sites.csv"');
    return res.send(toCsv(rows));
  });

  // A soft-deleted site is 404 for everyone; an admin restoring one asks for it
  // explicitly with ?includeDeleted=true.
  router.get('/:id', validate(siteIdSchema, 'params'), validate(includeDeletedSchema, 'query'), (req, res, next) => {
    try {
      const teamId = callerTeam(req);
      const wantsDeleted = req.validated.query.includeDeleted;
      if (wantsDeleted && req.user.role !== 'admin') {
        throw new HttpError(403, 'Only administrators can read deleted sites');
      }
      const site = wantsDeleted
        ? sites.findById(req.validated.params.id, teamId)
        : sites.findVisibleById(req.validated.params.id, teamId);
      if (!site) throw new HttpError(404, 'Site not found');
      return res.json({ ok: true, site });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/', validate(createSiteSchema), (req, res, next) => {
    try {
      assertAssignable(req.validated.body.assignedTo);
      const site = sites.create(req.validated.body, req.user.id, callerTeam(req));
      recordAudit(db, {
        userId: req.user.id, action: 'site.create', entityType: 'site', entityId: site.id,
        details: { name: site.name, teamId: site.teamId },
      });
      return res.status(201).json({ ok: true, site });
    } catch (error) {
      return next(error);
    }
  });

  const applyUpdate = (req, res, next) => {
    try {
      const teamId = callerTeam(req);
      const { id } = req.validated.params;
      if (!sites.findVisibleById(id, teamId)) throw new HttpError(404, 'Site not found');
      assertAssignable(req.validated.body.assignedTo);
      const site = sites.update(id, req.validated.body, req.user.id, teamId);
      recordAudit(db, {
        userId: req.user.id, action: 'site.update', entityType: 'site', entityId: id,
        details: { ...req.validated.body, teamId },
      });
      return res.json({ ok: true, site });
    } catch (error) {
      return next(error);
    }
  };

  router.patch('/:id', validate(siteIdSchema, 'params'), validate(updateSiteSchema), applyUpdate);
  // Kept as an alias: this API has always applied partial updates on PUT.
  router.put('/:id', validate(siteIdSchema, 'params'), validate(updateSiteSchema), applyUpdate);

  router.delete('/:id', requireRole('admin'), validate(siteIdSchema, 'params'), (req, res, next) => {
    try {
      const teamId = callerTeam(req);
      const { id } = req.validated.params;
      const existing = sites.findVisibleById(id, teamId);
      if (!existing) throw new HttpError(404, 'Site not found');
      sites.softDelete(id, req.user.id, teamId);
      recordAudit(db, {
        userId: req.user.id, action: 'site.delete', entityType: 'site', entityId: id,
        details: { name: existing.name, teamId },
      });
      return res.status(204).end();
    } catch (error) {
      return next(error);
    }
  });

  router.post('/:id/restore', requireRole('admin'), validate(siteIdSchema, 'params'), (req, res, next) => {
    try {
      const teamId = callerTeam(req);
      const { id } = req.validated.params;
      const existing = sites.findById(id, teamId);
      if (!existing) throw new HttpError(404, 'Site not found');
      if (existing.deletedAt === null) throw new HttpError(409, 'Site is not deleted');
      sites.restore(id, req.user.id, teamId);
      recordAudit(db, {
        userId: req.user.id, action: 'site.restore', entityType: 'site', entityId: id,
        details: { name: existing.name, teamId },
      });
      return res.json({ ok: true, site: sites.findById(id, teamId) });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
