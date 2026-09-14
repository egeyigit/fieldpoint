import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { shareTokenSchema } from '../collections/schema.js';
import { HttpError } from '../middleware/errors.js';
import { validate } from '../middleware/validate.js';

const SHARE_WINDOW_MS = 15 * 60 * 1000;
const SHARE_MAX_REQUESTS = 120;

export function createSharedRouter({ collections, config }) {
  const router = Router();
  router.use(rateLimit({
    windowMs: SHARE_WINDOW_MS,
    limit: config.isTest ? 1000 : SHARE_MAX_REQUESTS,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { ok: false, error: 'Too many attempts, try again later' },
  }));

  router.get('/:token', validate(shareTokenSchema, 'params'), (req, res, next) => {
    const collection = collections.findPublicByToken(req.validated.params.token);
    if (!collection) return next(new HttpError(404, 'Shared collection not found'));
    return res.json({ ok: true, collection });
  });

  return router;
}
