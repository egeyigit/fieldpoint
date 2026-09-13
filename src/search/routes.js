import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { validate } from '../middleware/validate.js';

const MAX_QUERY = 100;
const GROUP_LIMIT = 20;

const searchQuerySchema = z.object({
  q: z.string().trim().min(1, 'Search query is required').max(MAX_QUERY),
});

// Rank exact and prefix matches ahead of substring hits so the most likely
// target surfaces first; ties fall back to name/title order.
function rankHits(hits, term, key) {
  const needle = term.toLowerCase();
  return [...hits]
    .map((hit) => {
      const value = String(hit[key] ?? '').toLowerCase();
      let score = 3;
      if (value === needle) score = 0;
      else if (value.startsWith(needle)) score = 1;
      else if (value.includes(needle)) score = 2;
      return { hit, score };
    })
    .sort((left, right) => left.score - right.score || String(left.hit[key]).localeCompare(String(right.hit[key])))
    .map((entry) => entry.hit)
    .slice(0, GROUP_LIMIT);
}

export function createSearchRouter({ sites, workOrders }) {
  const router = Router();
  router.use(requireAuth);

  router.get('/', validate(searchQuerySchema, 'query'), (req, res, next) => {
    try {
      const { q } = req.validated.query;
      const siteHits = rankHits(sites.search(q), q, 'name');
      const workOrderHits = rankHits(workOrders.search(q), q, 'title');
      return res.json({ ok: true, sites: siteHits, workOrders: workOrderHits });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}
