import { Router } from 'express';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { validate } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';
import { recordAudit } from '../audit/log.js';
import {
  createTemplateSchema,
  listTemplatesSchema,
  templateIdSchema,
  updateTemplateSchema,
} from './schema.js';

export function createTemplateRouter({ db, templates }) {
  const router = Router();
  router.use(requireAuth);

  // Anyone may read templates — a technician creating a job needs the list.
  router.get('/', validate(listTemplatesSchema, 'query'), (req, res) => {
    res.json({ ok: true, templates: templates.list(req.validated.query) });
  });

  router.get('/:id', validate(templateIdSchema, 'params'), (req, res, next) => {
    const template = templates.findById(req.validated.params.id);
    if (!template) return next(new HttpError(404, 'Template not found'));
    return res.json({ ok: true, template });
  });

  // Preview shows exactly what a generated work order would contain, writing
  // nothing: an admin can inspect a template before a schedule sweep uses it.
  router.get('/:id/preview', validate(templateIdSchema, 'params'), (req, res, next) => {
    const template = templates.findById(req.validated.params.id);
    if (!template) return next(new HttpError(404, 'Template not found'));
    return res.json({
      ok: true,
      preview: {
        title: template.title,
        description: template.description,
        priority: template.priority,
        estimatedMinutes: template.estimatedMinutes,
        checklist: template.items.map((item) => item.text),
      },
    });
  });

  // Writing them is an admin job: a template is shared state.
  router.post('/', requireRole('admin'), validate(createTemplateSchema), (req, res, next) => {
    try {
      const body = req.validated.body;
      if (templates.nameTaken(body.name)) {
        throw new HttpError(409, 'A template with that name already exists');
      }
      const template = templates.create(body, req.user.id);
      recordAudit(db, {
        userId: req.user.id, action: 'template.create', entityType: 'template', entityId: template.id,
        details: { name: template.name, items: template.items.length },
      });
      return res.status(201).json({ ok: true, template });
    } catch (error) {
      return next(error);
    }
  });

  router.patch(
    '/:id',
    requireRole('admin'),
    validate(templateIdSchema, 'params'),
    validate(updateTemplateSchema),
    (req, res, next) => {
      try {
        const { id } = req.validated.params;
        if (!templates.findById(id)) throw new HttpError(404, 'Template not found');
        const body = req.validated.body;
        if (body.name !== undefined && templates.nameTaken(body.name, id)) {
          throw new HttpError(409, 'A template with that name already exists');
        }
        const template = templates.update(id, body, req.user.id);
        recordAudit(db, {
          userId: req.user.id, action: 'template.update', entityType: 'template', entityId: id,
          details: { fields: Object.keys(body) },
        });
        return res.json({ ok: true, template });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.delete('/:id', requireRole('admin'), validate(templateIdSchema, 'params'), (req, res, next) => {
    const { id } = req.validated.params;
    const existing = templates.findById(id);
    if (!existing) return next(new HttpError(404, 'Template not found'));
    // Deletion detaches the template from every referencing schedule and
    // work order (ON DELETE SET NULL). When it is in use, require an explicit
    // confirm flag and hand back the counts so the caller can name them.
    const usage = existing.usage;
    const inUse = usage.schedules > 0 || usage.workOrders > 0;
    if (inUse && req.query.confirm !== 'true') {
      throw new HttpError(409, 'Template is in use', { usage });
    }
    templates.remove(id);
    recordAudit(db, {
      userId: req.user.id, action: 'template.delete', entityType: 'template', entityId: id,
      details: { name: existing.name, usage },
    });
    return res.status(204).end();
  });

  return router;
}
