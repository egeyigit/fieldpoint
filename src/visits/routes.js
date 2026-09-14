import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { recordAudit } from '../audit/log.js';
import { HttpError } from '../middleware/errors.js';
import { validate } from '../middleware/validate.js';
import { toCsvRows } from '../sites/csv.js';
import {
  createVisitSchema,
  listSiteVisitsSchema,
  listVisitsSchema,
  siteVisitParamsSchema,
  updateVisitSchema,
  visitIdSchema,
} from './schema.js';

export function createVisitRouter({ db, visits }) {
  const router = Router();
  router.use(requireAuth);

  router.get('/', validate(listVisitsSchema, 'query'), (req, res, next) => {
    try {
      const query = req.validated.query;
      const userId = query.userId ?? req.user.id;
      if (userId !== req.user.id && req.user.role !== 'admin') {
        throw new HttpError(403, 'Only administrators can read another user\'s visits');
      }
      const { rows, total } = visits.listForUser(userId, query);
      return res.json({ ok: true, visits: rows, total, limit: query.limit, offset: query.offset });
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/:id', validate(visitIdSchema, 'params'), validate(updateVisitSchema), (req, res, next) => {
    try {
      const visit = loadVisit(visits, req.validated.params.id);
      assertMayEdit(req, visit);
      const updated = visits.update(visit.id, req.validated.body);
      recordAudit(db, {
        userId: req.user.id, action: 'visit.update', entityType: 'visit', entityId: visit.id,
        details: req.validated.body,
      });
      return res.json({ ok: true, visit: updated });
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/:id', validate(visitIdSchema, 'params'), (req, res, next) => {
    try {
      const visit = loadVisit(visits, req.validated.params.id);
      assertMayEdit(req, visit);
      visits.remove(visit.id);
      recordAudit(db, {
        userId: req.user.id, action: 'visit.delete', entityType: 'visit', entityId: visit.id,
        details: { siteId: visit.siteId, authorId: visit.userId },
      });
      return res.status(204).end();
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

export function createSiteVisitRouter({ db, sites, visits }) {
  const router = Router();
  router.use(requireAuth);

  router.get(
    '/:id/visits',
    validate(siteVisitParamsSchema, 'params'),
    validate(listSiteVisitsSchema, 'query'),
    (req, res, next) => {
      try {
        const siteId = req.validated.params.id;
        if (!sites.findVisibleById(siteId)) throw new HttpError(404, 'Site not found');
        const query = req.validated.query;
        const { rows, total } = visits.listForSite(siteId, query);
        return res.json({ ok: true, visits: rows, total, limit: query.limit, offset: query.offset });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.get(
    '/:id/visits/export.csv',
    validate(siteVisitParamsSchema, 'params'),
    (req, res, next) => {
      try {
        const siteId = req.validated.params.id;
        if (!sites.findVisibleById(siteId)) throw new HttpError(404, 'Site not found');
        const rows = visits.listAllForSite(siteId);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="site-${siteId}-visits.csv"`);
        return res.send(toCsvRows(['visitedAt', 'rating', 'note', 'userName', 'createdAt'], rows));
      } catch (error) {
        return next(error);
      }
    },
  );

  router.post(
    '/:id/visits',
    validate(siteVisitParamsSchema, 'params'),
    validate(createVisitSchema),
    (req, res, next) => {
      try {
        const siteId = req.validated.params.id;
        if (!sites.findVisibleById(siteId)) throw new HttpError(404, 'Site not found');
        const visit = visits.create(siteId, req.user.id, req.validated.body);
        recordAudit(db, {
          userId: req.user.id, action: 'visit.create', entityType: 'visit', entityId: visit.id,
          details: { siteId, visitedAt: visit.visitedAt, rating: visit.rating },
        });
        return res.status(201).json({ ok: true, visit });
      } catch (error) {
        return next(error);
      }
    },
  );

  return router;
}

function loadVisit(visits, id) {
  const visit = visits.findById(id);
  if (!visit) throw new HttpError(404, 'Visit not found');
  return visit;
}

function assertMayEdit(req, visit) {
  if (visit.userId !== req.user.id && req.user.role !== 'admin') {
    throw new HttpError(403, 'You can only edit your own visits');
  }
}
