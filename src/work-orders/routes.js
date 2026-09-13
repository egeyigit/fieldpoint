import { Router } from 'express';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { validate } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';
import { describeChanges, recordAudit } from '../audit/log.js';
import {
  createCommentSchema,
  createWorkOrderSchema,
  listWorkOrdersSchema,
  updateWorkOrderSchema,
  workOrderIdSchema,
} from './schema.js';

export function createWorkOrderRouter({ db, workOrders, sites, users }) {
  const router = Router();
  router.use(requireAuth);

  function assertAssignable(assignedTo) {
    if (assignedTo === undefined || assignedTo === null) return;
    const user = users.findById(assignedTo);
    if (!user) throw new HttpError(400, 'Assigned user does not exist', [{ path: 'assignedTo', message: 'Unknown user' }]);
    if (!user.isActive) {
      throw new HttpError(400, 'Assigned user is deactivated', [{ path: 'assignedTo', message: 'User is not active' }]);
    }
  }

  function loadOrder(id) {
    const order = workOrders.findById(id);
    if (!order) throw new HttpError(404, 'Work order not found');
    return order;
  }

  router.get('/', validate(listWorkOrdersSchema, 'query'), (req, res) => {
    const query = req.validated.query;
    const { rows, total } = workOrders.list(query);
    res.json({ ok: true, workOrders: rows, total, limit: query.limit, offset: query.offset });
  });

  router.get('/summary', (_req, res) => {
    res.json({ ok: true, summary: workOrders.summary() });
  });

  router.get('/:id', validate(workOrderIdSchema, 'params'), (req, res, next) => {
    try {
      const order = loadOrder(req.validated.params.id);
      return res.json({ ok: true, workOrder: order, comments: workOrders.comments(order.id) });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/', validate(createWorkOrderSchema), (req, res, next) => {
    try {
      const body = req.validated.body;
      if (!sites.findVisibleById(body.siteId)) {
        throw new HttpError(400, 'Site does not exist', [{ path: 'siteId', message: 'Unknown site' }]);
      }
      assertAssignable(body.assignedTo);
      const order = workOrders.create(body, req.user.id);
      recordAudit(db, {
        userId: req.user.id, action: 'work_order.create', entityType: 'work_order', entityId: order.id,
        details: { title: order.title, siteId: order.siteId },
      });
      return res.status(201).json({ ok: true, workOrder: order });
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/:id', validate(workOrderIdSchema, 'params'), validate(updateWorkOrderSchema), (req, res, next) => {
    try {
      const existing = loadOrder(req.validated.params.id);
      assertAssignable(req.validated.body.assignedTo);
      const order = workOrders.update(existing.id, req.validated.body, req.user.id);
      recordAudit(db, {
        userId: req.user.id, action: 'work_order.update', entityType: 'work_order', entityId: order.id,
        details: { changes: describeChanges(existing, req.validated.body, { redact: ['description'] }) },
      });
      return res.json({ ok: true, workOrder: order });
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/:id', requireRole('admin'), validate(workOrderIdSchema, 'params'), (req, res, next) => {
    try {
      const existing = loadOrder(req.validated.params.id);
      workOrders.remove(existing.id);
      recordAudit(db, {
        userId: req.user.id, action: 'work_order.delete', entityType: 'work_order', entityId: existing.id,
        details: { title: existing.title },
      });
      return res.status(204).end();
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:id/comments', validate(workOrderIdSchema, 'params'), (req, res, next) => {
    try {
      const order = loadOrder(req.validated.params.id);
      return res.json({ ok: true, comments: workOrders.comments(order.id) });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/:id/comments', validate(workOrderIdSchema, 'params'), validate(createCommentSchema), (req, res, next) => {
    try {
      const order = loadOrder(req.validated.params.id);
      const comment = workOrders.addComment(order.id, req.user.id, req.validated.body.body);
      recordAudit(db, {
        userId: req.user.id, action: 'work_order.comment', entityType: 'work_order', entityId: order.id,
        details: { commentId: comment.id },
      });
      return res.status(201).json({ ok: true, comment });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
