import { Router } from 'express';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { validate } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';
import { recordAudit } from '../audit/log.js';
import { categoryIdSchema, createCategorySchema, updateCategorySchema } from './schema.js';

export function createSiteCategoryRouter({ db, siteCategories }) {
  const router = Router();
  router.use(requireAuth);

  // Any signed-in user needs the active list to render the picker and map pins;
  // admins get every category (including archived) to manage them.
  router.get('/', (req, res) => {
    const categories = req.user.role === 'admin' ? siteCategories.list() : siteCategories.listActive();
    res.json({ ok: true, categories });
  });

  router.post('/', requireRole('admin'), validate(createCategorySchema), (req, res, next) => {
    try {
      if (siteCategories.exists(req.validated.body.slug)) {
        throw new HttpError(409, 'A category with that slug already exists', [
          { path: 'slug', message: 'Slug is already in use' },
        ]);
      }
      const category = siteCategories.create(req.validated.body);
      recordAudit(db, {
        userId: req.user.id, action: 'site_category.create', entityType: 'site_category', entityId: category.id,
        details: { slug: category.slug },
      });
      return res.status(201).json({ ok: true, category });
    } catch (error) {
      return next(error);
    }
  });

  router.patch('/:id', requireRole('admin'), validate(categoryIdSchema, 'params'), validate(updateCategorySchema), (req, res, next) => {
    try {
      const { id } = req.validated.params;
      if (!siteCategories.findById(id)) throw new HttpError(404, 'Category not found');
      const category = siteCategories.update(id, req.validated.body);
      recordAudit(db, {
        userId: req.user.id, action: 'site_category.update', entityType: 'site_category', entityId: id,
        details: req.validated.body,
      });
      return res.json({ ok: true, category });
    } catch (error) {
      return next(error);
    }
  });

  // Archive, not delete: existing sites keep their category, but the picker hides it.
  router.delete('/:id', requireRole('admin'), validate(categoryIdSchema, 'params'), (req, res, next) => {
    const { id } = req.validated.params;
    const existing = siteCategories.findById(id);
    if (!existing) return next(new HttpError(404, 'Category not found'));
    if (existing.archivedAt !== null) return next(new HttpError(409, 'Category is already archived'));
    siteCategories.archive(id);
    recordAudit(db, {
      userId: req.user.id, action: 'site_category.archive', entityType: 'site_category', entityId: id,
      details: { slug: existing.slug },
    });
    return res.status(204).end();
  });

  router.post('/:id/restore', requireRole('admin'), validate(categoryIdSchema, 'params'), (req, res, next) => {
    const { id } = req.validated.params;
    const existing = siteCategories.findById(id);
    if (!existing) return next(new HttpError(404, 'Category not found'));
    if (existing.archivedAt === null) return next(new HttpError(409, 'Category is not archived'));
    siteCategories.unarchive(id);
    recordAudit(db, {
      userId: req.user.id, action: 'site_category.restore', entityType: 'site_category', entityId: id,
      details: { slug: existing.slug },
    });
    return res.json({ ok: true, category: siteCategories.findById(id) });
  });

  return router;
}
