import { Router } from 'express';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { validate } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';
import { recordAudit } from '../audit/log.js';
import {
  createCommentSchema,
  createWorkOrderSchema,
  listWorkOrdersSchema,
  updateWorkOrderSchema,
  workOrderIdSchema,
} from './schema.js';

export function createWorkOrderRouter({ db, workOrders, sites, users, teams }) {
  const router = Router();
  router.use(requireAuth);

  /** The caller's team, or a 403 if they belong to none. */
  function callerTeam(req) {
    const teamId = teams.primaryTeamId(req.user.id);
    if (teamId === null) throw new HttpError(403, 'You do not belong to a team');
    return teamId;
  }

  function assertAssignable(assignedTo) {
    if (assignedTo === undefined || assignedTo === null) return;
    const user = users.findById(assignedTo);
    if (!user) throw new HttpError(400, 'Assigned user does not exist', [{ path: 'assignedTo', message: 'Unknown user' }]);
    if (!user.isActive) {
      throw new HttpError(400, 'Assigned user is deactivated', [{ path: 'assignedTo', message: 'User is not active' }]);
    }
  }

  function loadOrder(id, teamId) {
    const order = workOrders.findById(id, teamId);
    if (!order) throw new HttpError(404, 'Work order not found');
    return order;
  }

  router.get('/', validate(listWorkOrdersSchema, 'query'), (req, res, next) => {
    try {
      const query = req.validated.query;
      const { rows, total } = workOrders.list(query, callerTeam(req));
      res.json({ ok: true, workOrders: rows, total, limit: query.limit, offset: query.offset });
    } catch (error) {
      next(error);
    }
  });

  router.get('/summary', (req, res, next) => {
    try {
      res.json({ ok: true, summary: workOrders.summary(callerTeam(req)) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id', validate(workOrderIdSchema, 'params'), (req, res, next) => {
    try {
      const order = loadOrder(req.validated.params.id, callerTeam(req));
      return res.json({ ok: true, workOrder: order, comments: workOrders.comments(order.id) });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/', validate(createWorkOrderSchema), (req, res, next) => {
    try {
      const teamId = callerTeam(req);
      const body = req.validated.body;
      if (!sites.findVisibleById(body.siteId, teamId)) {
        throw new HttpError(400, 'Site does not exist', [{ path: 'siteId', message: 'Unknown site' }]);
      }
      assertAssignable(body.assignedTo);
      const order = workOrders.create(body, req.user.id, teamId);
      recordAudit(db, {
        userId: req.user.id, action: 'work_order.create', entityType: 'work_order', entityId: order.id,
        details: { title: order.title, siteId: order.siteId, teamId: order.teamId },
      });
      return res.status(201).json({ ok: true, workOrder: order });
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/:id', validate(workOrderIdSchema, 'params'), validate(updateWorkOrderSchema), (req, res, next) => {
    try {
      const teamId = callerTeam(req);
      const existing = loadOrder(req.validated.params.id, teamId);
      assertAssignable(req.validated.body.assignedTo);
      const order = workOrders.update(existing.id, req.validated.body, req.user.id, teamId);
      recordAudit(db, {
        userId: req.user.id, action: 'work_order.update', entityType: 'work_order', entityId: order.id,
        details: { ...req.validated.body, teamId },
      });
      return res.json({ ok: true, workOrder: order });
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/:id', requireRole('admin'), validate(workOrderIdSchema, 'params'), (req, res, next) => {
    try {
      const teamId = callerTeam(req);
      const existing = loadOrder(req.validated.params.id, teamId);
      workOrders.remove(existing.id, teamId);
      recordAudit(db, {
        userId: req.user.id, action: 'work_order.delete', entityType: 'work_order', entityId: existing.id,
        details: { title: existing.title, teamId },
      });
      return res.status(204).end();
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:id/comments', validate(workOrderIdSchema, 'params'), (req, res, next) => {
    try {
      const order = loadOrder(req.validated.params.id, callerTeam(req));
      return res.json({ ok: true, comments: workOrders.comments(order.id) });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/:id/comments', validate(workOrderIdSchema, 'params'), validate(createCommentSchema), (req, res, next) => {
    try {
      const order = loadOrder(req.validated.params.id, callerTeam(req));
      const comment = workOrders.addComment(order.id, req.user.id, req.validated.body.body);
      recordAudit(db, {
        userId: req.user.id, action: 'work_order.comment', entityType: 'work_order', entityId: order.id,
        details: { commentId: comment.id, teamId: order.teamId },
      });
      return res.status(201).json({ ok: true, comment });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
