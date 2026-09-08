import { z } from 'zod';

export const SITE_CATEGORIES = ['office', 'warehouse', 'client', 'job_site', 'vehicle', 'other'];
export const SITE_STATUSES = ['active', 'inactive', 'planned'];

const MAX_NAME = 120;
const MAX_ADDRESS = 300;
const MAX_NOTES = 2000;
const MAX_SEARCH = 100;
const MAX_LIMIT = 1000;

const fields = {
  name: z.string().trim().min(1).max(MAX_NAME),
  address: z.string().trim().max(MAX_ADDRESS),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  category: z.enum(SITE_CATEGORIES),
  status: z.enum(SITE_STATUSES),
  notes: z.string().trim().max(MAX_NOTES),
};

export const createSiteSchema = z.object({
  ...fields,
  address: fields.address.default(''),
  status: fields.status.default('active'),
  notes: fields.notes.default(''),
});

// No defaults here: a partial update must only touch the keys the caller sent.
export const updateSiteSchema = z
  .object(fields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Nothing to update');

export const siteIdSchema = z.object({ id: z.coerce.number().int().positive() });

export const listSitesSchema = z
  .object({
    q: z.string().trim().max(MAX_SEARCH).optional(),
    category: z.enum(SITE_CATEGORIES).optional(),
    status: z.enum(SITE_STATUSES).optional(),
    minLat: z.coerce.number().min(-90).max(90).optional(),
    maxLat: z.coerce.number().min(-90).max(90).optional(),
    minLng: z.coerce.number().min(-180).max(180).optional(),
    maxLng: z.coerce.number().min(-180).max(180).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(500),
    offset: z.coerce.number().int().min(0).default(0),
  })
  // A viewport is all-or-nothing: partial bounds would silently drop the filter.
  .refine(
    (query) => {
      const bounds = [query.minLat, query.maxLat, query.minLng, query.maxLng];
      const present = bounds.filter((value) => value !== undefined).length;
      return present === 0 || present === 4;
    },
    { message: 'minLat, maxLat, minLng and maxLng must be provided together' },
  );
