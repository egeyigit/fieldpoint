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
    templates.remove(id);
    recordAudit(db, {
      userId: req.user.id, action: 'template.delete', entityType: 'template', entityId: id,
      details: { name: existing.name },
    });
    return res.status(204).end();
  });

  return router;
}
