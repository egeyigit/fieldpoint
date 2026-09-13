import { Router } from 'express';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { validate } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';
import { recordAudit } from '../audit/log.js';
import {
  checklistItemIdSchema,
  createChecklistItemSchema,
  createCommentSchema,
  createWorkOrderSchema,
  listWorkOrdersSchema,
  manualTimeLogSchema,
  setChecklistItemSchema,
  stopTimerSchema,
  timeLogIdSchema,
  updateWorkOrderSchema,
  workOrderIdSchema,
} from './schema.js';

export function createWorkOrderRouter({ db, workOrders, sites, users, templates, checklist, timeLogs }) {
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
      return res.json({
        ok: true,
        workOrder: order,
        comments: workOrders.comments(order.id),
        checklist: checklist.listFor(order.id),
        timeLogs: timeLogs.listFor(order.id),
        totalMinutes: timeLogs.totalMinutes(order.id),
        totalSeconds: timeLogs.totalSeconds(order.id),
      });
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
      if (body.templateId !== undefined && body.templateId !== null && !templates.findById(body.templateId)) {
        throw new HttpError(400, 'Template does not exist', [{ path: 'templateId', message: 'Unknown template' }]);
      }
      const order = workOrders.create(body, req.user.id);
      // The checklist is copied, not linked: later template edits must not
      // rewrite what this order asked a technician to do.
      if (body.templateId) {
        const items = templates.itemsFor(body.templateId).map((item) => item.text);
        if (items.length > 0) checklist.addMany(order.id, items);
      }
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
        details: req.validated.body,
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

  // --- Checklist -----------------------------------------------------------

  router.get('/:id/checklist', validate(workOrderIdSchema, 'params'), (req, res, next) => {
    try {
      const order = loadOrder(req.validated.params.id);
      return res.json({ ok: true, checklist: checklist.listFor(order.id), progress: checklist.progressFor(order.id) });
    } catch (error) {
      return next(error);
    }
  });

  router.post(
    '/:id/checklist',
    validate(workOrderIdSchema, 'params'),
    validate(createChecklistItemSchema),
    (req, res, next) => {
      try {
        const order = loadOrder(req.validated.params.id);
        const item = checklist.add(order.id, req.validated.body.text);
        return res.status(201).json({ ok: true, item });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.patch(
    '/:id/checklist/:itemId',
    validate(checklistItemIdSchema, 'params'),
    validate(setChecklistItemSchema),
    (req, res, next) => {
      try {
        const order = loadOrder(req.validated.params.id);
        const existing = checklist.findById(req.validated.params.itemId);
        if (!existing || existing.workOrderId !== order.id) {
          throw new HttpError(404, 'Checklist item not found');
        }
        const item = checklist.setDone(existing.id, req.validated.body.isDone, req.user.id);
        return res.json({ ok: true, item, progress: checklist.progressFor(order.id) });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.delete('/:id/checklist/:itemId', validate(checklistItemIdSchema, 'params'), (req, res, next) => {
    try {
      const order = loadOrder(req.validated.params.id);
      const existing = checklist.findById(req.validated.params.itemId);
      if (!existing || existing.workOrderId !== order.id) {
        throw new HttpError(404, 'Checklist item not found');
      }
      checklist.remove(existing.id);
      return res.status(204).end();
    } catch (error) {
      return next(error);
    }
  });

  // --- Time logs -----------------------------------------------------------

  router.get('/:id/time', validate(workOrderIdSchema, 'params'), (req, res, next) => {
    try {
      const order = loadOrder(req.validated.params.id);
      return res.json({
        ok: true,
        timeLogs: timeLogs.listFor(order.id),
        totalMinutes: timeLogs.totalMinutes(order.id),
        totalSeconds: timeLogs.totalSeconds(order.id),
      });
    } catch (error) {
      return next(error);
    }
  });

  /** Clocks the caller in. One person can only be on one job at a time. */
  router.post('/:id/time/start', validate(workOrderIdSchema, 'params'), (req, res, next) => {
    try {
      const order = loadOrder(req.validated.params.id);
      const open = timeLogs.openForUser(req.user.id);
      if (open) {
        throw new HttpError(409, 'You are already clocked in to another work order', [
          { path: 'workOrderId', message: String(open.workOrderId) },
        ]);
      }
      const log = timeLogs.start(order.id, req.user.id);
      recordAudit(db, {
        userId: req.user.id, action: 'work_order.time_start', entityType: 'work_order', entityId: order.id,
        details: { timeLogId: log.id },
      });
      return res.status(201).json({ ok: true, timeLog: log });
    } catch (error) {
      return next(error);
    }
  });

  router.post(
    '/:id/time/stop',
    validate(workOrderIdSchema, 'params'),
    validate(stopTimerSchema),
    (req, res, next) => {
      try {
        const order = loadOrder(req.validated.params.id);
        const open = timeLogs.openForUser(req.user.id);
        if (!open || open.workOrderId !== order.id) {
          throw new HttpError(409, 'You are not clocked in to this work order');
        }
        const log = timeLogs.stop(open.id, req.validated.body.note);
        recordAudit(db, {
          userId: req.user.id, action: 'work_order.time_stop', entityType: 'work_order', entityId: order.id,
          details: { timeLogId: log.id, minutes: log.minutes },
        });
        return res.json({
          ok: true,
          timeLog: log,
          totalMinutes: timeLogs.totalMinutes(order.id),
          totalSeconds: timeLogs.totalSeconds(order.id),
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.post(
    '/:id/time',
    validate(workOrderIdSchema, 'params'),
    validate(manualTimeLogSchema),
    (req, res, next) => {
      try {
        const order = loadOrder(req.validated.params.id);
        const log = timeLogs.addManual(order.id, req.user.id, req.validated.body);
        return res.status(201).json({
          ok: true,
          timeLog: log,
          totalMinutes: timeLogs.totalMinutes(order.id),
          totalSeconds: timeLogs.totalSeconds(order.id),
        });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.delete('/:id/time/:logId', validate(timeLogIdSchema, 'params'), (req, res, next) => {
    try {
      const order = loadOrder(req.validated.params.id);
      const log = timeLogs.findById(req.validated.params.logId);
      if (!log || log.workOrderId !== order.id) throw new HttpError(404, 'Time log not found');
      // Your own time is yours to correct; anyone else's is an admin matter.
      if (log.userId !== req.user.id && req.user.role !== 'admin') {
        throw new HttpError(403, 'You can only delete your own time logs');
      }
      timeLogs.remove(log.id);
      return res.status(204).end();
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
