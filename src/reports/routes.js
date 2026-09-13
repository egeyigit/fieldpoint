import { Router } from 'express';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { validate } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';
import { recordAudit } from '../audit/log.js';
import { templateIdSchema } from '../templates/schema.js';

export function createReportRouter({ db, reports, templates }) {
  const router = Router();
  router.use(requireAuth);

  // Completed orders grouped by template, median actual minutes vs estimate.
  router.get('/estimates', (_req, res) => {
    res.json({ ok: true, estimates: reports.estimatesByTemplate() });
  });

  // Adopt the measured median as the template's estimate. Admin-only: the
  // estimate is shared state that drives every future schedule forecast.
  router.post(
    '/estimates/:id/adopt',
    requireRole('admin'),
    validate(templateIdSchema, 'params'),
    (req, res, next) => {
      try {
        const { id } = req.validated.params;
        if (!templates.findById(id)) throw new HttpError(404, 'Template not found');
        const row = reports.estimatesByTemplate().find((entry) => entry.templateId === id);
        if (!row || row.medianMinutes === null) {
          throw new HttpError(400, 'No completed, time-logged orders for this template');
        }
        const estimatedMinutes = Math.round(row.medianMinutes);
        const template = templates.update(id, { estimatedMinutes }, req.user.id);
        recordAudit(db, {
          userId: req.user.id, action: 'template.adopt_estimate', entityType: 'template', entityId: id,
          details: { estimatedMinutes, count: row.count },
        });
        return res.json({ ok: true, template });
      } catch (error) {
        return next(error);
      }
    },
  );

  return router;
}
