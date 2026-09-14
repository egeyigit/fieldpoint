import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { recordAudit } from '../audit/log.js';
import { HttpError } from '../middleware/errors.js';
import { validate } from '../middleware/validate.js';
import {
  collectionIdSchema,
  collectionSiteParamsSchema,
  createCollectionSchema,
  emptyQuerySchema,
  updateCollectionSchema,
} from './schema.js';

export function createCollectionRouter({ db, collections, sites }) {
  const router = Router();
  router.use(requireAuth);

  router.get('/', validate(emptyQuerySchema, 'query'), (req, res) => {
    res.json({ ok: true, collections: collections.listForOwner(req.user.id) });
  });

  router.post('/', validate(createCollectionSchema), (req, res, next) => {
    try {
      const collection = collections.create(req.user.id, req.validated.body);
      recordAudit(db, {
        userId: req.user.id, action: 'collection.create', entityType: 'collection', entityId: collection.id,
        details: { name: collection.name },
      });
      return res.status(201).json({ ok: true, collection });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:id', validate(collectionIdSchema, 'params'), (req, res, next) => {
    try {
      const collection = loadAccessible(req, collections, req.validated.params.id);
      return res.json({ ok: true, collection: { ...collection, sites: collections.sitesFor(collection.id) } });
    } catch (error) {
      return next(error);
    }
  });

  router.patch(
    '/:id',
    validate(collectionIdSchema, 'params'),
    validate(updateCollectionSchema),
    (req, res, next) => {
      try {
        const collection = loadAccessible(req, collections, req.validated.params.id);
        const updated = collections.update(collection.id, req.validated.body);
        recordAudit(db, {
          userId: req.user.id, action: 'collection.update', entityType: 'collection', entityId: collection.id,
          details: req.validated.body,
        });
        return res.json({ ok: true, collection: updated });
      } catch (error) {
        return next(error);
      }
    },
  );

  router.delete('/:id', validate(collectionIdSchema, 'params'), (req, res, next) => {
    try {
      const collection = loadAccessible(req, collections, req.validated.params.id);
      collections.remove(collection.id);
      recordAudit(db, {
        userId: req.user.id, action: 'collection.delete', entityType: 'collection', entityId: collection.id,
        details: { name: collection.name },
      });
      return res.status(204).end();
    } catch (error) {
      return next(error);
    }
  });

  router.post('/:id/sites/:siteId', validate(collectionSiteParamsSchema, 'params'), (req, res, next) => {
    try {
      const { id, siteId } = req.validated.params;
      loadAccessible(req, collections, id);
      if (!sites.findVisibleById(siteId)) throw new HttpError(404, 'Site not found');
      const created = collections.pin(id, siteId, req.user.id);
      if (created) {
        recordAudit(db, {
          userId: req.user.id, action: 'collection.pin', entityType: 'collection', entityId: id, details: { siteId },
        });
      }
      return res.status(created ? 201 : 200).json({ ok: true, pinned: true });
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/:id/sites/:siteId', validate(collectionSiteParamsSchema, 'params'), (req, res, next) => {
    try {
      const { id, siteId } = req.validated.params;
      loadAccessible(req, collections, id);
      const removed = collections.unpin(id, siteId);
      if (removed) {
        recordAudit(db, {
          userId: req.user.id, action: 'collection.unpin', entityType: 'collection', entityId: id, details: { siteId },
        });
      }
      return res.status(204).end();
    } catch (error) {
      return next(error);
    }
  });

  router.post('/:id/share', validate(collectionIdSchema, 'params'), (req, res, next) => {
    try {
      let collection = loadAccessible(req, collections, req.validated.params.id);
      const minted = collection.shareToken === null;
      if (minted) collection = collections.setShareToken(collection.id, randomBytes(24).toString('base64url'));
      recordAudit(db, {
        userId: req.user.id, action: 'collection.share', entityType: 'collection', entityId: collection.id,
        details: { minted },
      });
      const shareUrl = `${req.protocol}://${req.get('host')}/shared/${collection.shareToken}`;
      return res.json({ ok: true, shareToken: collection.shareToken, shareUrl });
    } catch (error) {
      return next(error);
    }
  });

  router.delete('/:id/share', validate(collectionIdSchema, 'params'), (req, res, next) => {
    try {
      const collection = loadAccessible(req, collections, req.validated.params.id);
      collections.clearShareToken(collection.id);
      recordAudit(db, {
        userId: req.user.id, action: 'collection.unshare', entityType: 'collection', entityId: collection.id,
      });
      return res.status(204).end();
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

function loadAccessible(req, collections, id) {
  const collection = collections.findById(id);
  if (!collection) throw new HttpError(404, 'Collection not found');
  if (collection.ownerId !== req.user.id && req.user.role !== 'admin') {
    throw new HttpError(403, 'You cannot access this collection');
  }
  return collection;
}
