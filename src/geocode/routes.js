import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { validate } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';
import { GeocodeUpstreamError } from './service.js';

const geocodeQuerySchema = z.object({
  q: z.string().trim().min(1, 'A search query is required').max(300),
});

export function createGeocodeRouter({ geocoder }) {
  const router = Router();
  router.use(requireAuth);

  router.get('/', validate(geocodeQuerySchema, 'query'), async (req, res, next) => {
    try {
      const result = await geocoder.geocode(req.validated.query.q);
      if (!result) throw new HttpError(404, 'Address not found');
      return res.json({ ok: true, result });
    } catch (error) {
      if (error instanceof GeocodeUpstreamError) {
        return next(new HttpError(502, 'Geocoding service unavailable'));
      }
      return next(error);
    }
  });

  return router;
}
