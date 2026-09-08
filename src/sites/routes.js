import { Router } from 'express';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { validate } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';
import { recordAudit } from '../audit/log.js';
import { bulkUpdateSchema, createSiteSchema, listSitesSchema, siteIdSchema, updateSiteSchema } from './schema.js';
import { toCsv } from './csv.js';

export function createSiteRouter({ db, sites }) {
  const router = Router();
  router.use(requireAuth);

  router.get('/', validate(listSitesSchema, 'query'), (req, res) => {
    const { rows, total } = sites.list(req.validated.query);
    res.json({ ok: true, sites: rows, total, limit: req.validated.query.limit, offset: req.validated.query.offset });
  });

  router.get('/stats', (_req, res) => {
    res.json({ ok: true, stats: sites.stats() });
  });

  router.get('/export.csv', validate(listSitesSchema, 'query'), (req, res) => {
    const rows = sites.listAll(req.validated.query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="sites.csv"');
    res.send(toCsv(rows));
  });

  router.get('/:id', validate(siteIdSchema, 'params'), (req, res, next) => {
    const site = sites.findById(req.validated.params.id);
    if (!site) return next(new HttpError(404, 'Site not found'));
    return res.json({ ok: true, site });
  });

  router.post('/', validate(createSiteSchema), (req, res) => {
    const site = sites.create(req.validated.body, req.user.id);
    recordAudit(db, { userId: req.user.id, action: 'site.create', entityType: 'site', entityId: site.id, details: { name: site.name } });
    res.status(201).json({ ok: true, site });
  });

  router.patch('/bulk', validate(bulkUpdateSchema), (req, res, next) => {
    const { ids, changes } = req.validated.body;
    const { delete: remove, ...fieldChanges } = changes;
    if (remove && req.user.role !== 'admin') {
      return next(new HttpError(403, 'Insufficient permissions'));
    }
    const hasFieldChanges = Object.keys(fieldChanges).length > 0;

    try {
      const affected = sites.db.transaction((batch) => {
        const updated = [];
        for (const id of batch) {
          if (!sites.findById(id)) throw new HttpError(404, `Site ${id} not found`);
          if (hasFieldChanges) sites.update(id, fieldChanges, req.user.id);
          if (remove) sites.remove(id);
          updated.push(id);
        }
        return updated;
      })(ids);

      recordAudit(db, {
        userId: req.user.id,
        action: remove ? 'site.bulk_delete' : 'site.bulk_update',
        entityType: 'site',
        entityId: null,
        details: { ids: affected, changes },
      });

      if (remove) return res.json({ ok: true, deleted: affected });
      return res.json({ ok: true, sites: affected.map((id) => sites.findById(id)).filter(Boolean) });
    } catch (error) {
      return next(error);
    }
  });

  router.put('/:id', validate(siteIdSchema, 'params'), validate(updateSiteSchema), (req, res, next) => {
    const { id } = req.validated.params;
    if (!sites.findById(id)) return next(new HttpError(404, 'Site not found'));
    const site = sites.update(id, req.validated.body, req.user.id);
    recordAudit(db, { userId: req.user.id, action: 'site.update', entityType: 'site', entityId: id, details: req.validated.body });
    return res.json({ ok: true, site });
  });

  router.delete('/:id', requireRole('admin'), validate(siteIdSchema, 'params'), (req, res, next) => {
    const { id } = req.validated.params;
    const existing = sites.findById(id);
    if (!existing) return next(new HttpError(404, 'Site not found'));
    sites.remove(id);
    recordAudit(db, { userId: req.user.id, action: 'site.delete', entityType: 'site', entityId: id, details: { name: existing.name } });
    return res.status(204).end();
  });

  return router;
}
