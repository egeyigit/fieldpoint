import { Router } from 'express';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { validate } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';
import { recordAudit } from '../audit/log.js';
import {
  createScheduleSchema,
  listSchedulesSchema,
  scheduleIdSchema,
  updateScheduleSchema,
} from './schema.js';
import { generateDueWorkOrders } from './generator.js';

export function createMaintenanceRouter(deps) {
  const { db, schedules, sites, users, templates } = deps;
  const router = Router();
  router.use(requireAuth);

  function assertReferences({ siteId, assignedTo, templateId }) {
    if (siteId !== undefined && !sites.findVisibleById(siteId)) {
      throw new HttpError(400, 'Site does not exist', [{ path: 'siteId', message: 'Unknown site' }]);
    }
    if (assignedTo !== undefined && assignedTo !== null) {
      const user = users.findById(assignedTo);
      if (!user) throw new HttpError(400, 'Assigned user does not exist', [{ path: 'assignedTo', message: 'Unknown user' }]);
      if (!user.isActive) {
        throw new HttpError(400, 'Assigned user is deactivated', [{ path: 'assignedTo', message: 'User is not active' }]);
      }
    }
    if (templateId !== undefined && templateId !== null && !templates.findById(templateId)) {
      throw new HttpError(400, 'Template does not exist', [{ path: 'templateId', message: 'Unknown template' }]);
    }
  }

  router.get('/', validate(listSchedulesSchema, 'query'), (req, res) => {
    res.json({ ok: true, schedules: schedules.list(req.validated.query) });
  });

  router.get('/:id', validate(scheduleIdSchema, 'params'), (req, res, next) => {
    const schedule = schedules.findById(req.validated.params.id);
    if (!schedule) return next(new HttpError(404, 'Schedule not found'));
    return res.json({ ok: true, schedule });
  });

  router.post('/', requireRole('admin'), validate(createScheduleSchema), (req, res, next) => {
    try {
      assertReferences(req.validated.body);
      const schedule = schedules.create(req.validated.body, req.user.id);
      recordAudit(db, {
        userId: req.user.id, action: 'schedule.create', entityType: 'schedule', entityId: schedule.id,
        details: { title: schedule.title, siteId: schedule.siteId, intervalDays: schedule.intervalDays },
      });
      return res.status(201).json({ ok: true, schedule });
    } catch (error) {
      return next(error);
    }
  });

  router.patch(
    '/:id',
    requireRole('admin'),
    validate(scheduleIdSchema, 'params'),
    validate(updateScheduleSchema),
    (req, res, next) => {
      try {
        const { id } = req.validated.params;
        if (!schedules.findById(id)) throw new HttpError(404, 'Schedule not found');
        assertReferences(req.validated.body);
        const schedule = schedules.update(id, req.validated.body, req.user.id);
        recordAudit(db, {
          userId: req.user.id, action: 'schedule.update', entityType: 'schedule', entityId: id,
          details: { fields: Object.keys(req.validated.body) },
        });
        return res.json({ ok: true, schedule });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.delete('/:id', requireRole('admin'), validate(scheduleIdSchema, 'params'), (req, res, next) => {
    const { id } = req.validated.params;
    const existing = schedules.findById(id);
    if (!existing) return next(new HttpError(404, 'Schedule not found'));
    schedules.remove(id);
    recordAudit(db, {
      userId: req.user.id, action: 'schedule.delete', entityType: 'schedule', entityId: id,
      details: { title: existing.title },
    });
    return res.status(204).end();
  });

  /** Runs the sweep now instead of waiting for the timer. */
  router.post('/run', requireRole('admin'), (req, res) => {
    const created = generateDueWorkOrders(db, { ...deps, actorId: req.user.id });
    if (created.length > 0) {
      recordAudit(db, {
        userId: req.user.id, action: 'schedule.generate', entityType: 'schedule',
        details: { created: created.length },
      });
    }
    res.json({ ok: true, created });
  });

  return router;
}
