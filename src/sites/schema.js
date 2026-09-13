import { z } from 'zod';

export const SITE_CATEGORIES = ['office', 'warehouse', 'client', 'job_site', 'vehicle', 'other'];
export const SITE_STATUSES = ['active', 'inactive', 'planned'];
export const SITE_SORTS = ['name', 'created', 'updated', 'distance'];

const MAX_NAME = 120;
const MAX_ADDRESS = 300;
const MAX_NOTES = 2000;
const MAX_SEARCH = 100;
const MAX_LIMIT = 1000;
const MAX_RADIUS_KM = 20000;

const fields = {
  name: z.string().trim().min(1).max(MAX_NAME),
  address: z.string().trim().max(MAX_ADDRESS),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  category: z.enum(SITE_CATEGORIES),
  status: z.enum(SITE_STATUSES),
  notes: z.string().trim().max(MAX_NOTES),
  assignedTo: z.coerce.number().int().positive().nullable(),
};

export const createSiteSchema = z.object({
  ...fields,
  address: fields.address.default(''),
  status: fields.status.default('active'),
  notes: fields.notes.default(''),
  assignedTo: fields.assignedTo.default(null),
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
    assignedTo: z.coerce.number().int().positive().optional(),
    hasOverdue: z
      .union([z.boolean(), z.enum(['true', 'false'])])
      .transform((value) => value === true || value === 'true')
      .default(false),
    // Map viewport filter. All four are required together.
    north: z.coerce.number().min(-90).max(90).optional(),
    south: z.coerce.number().min(-90).max(90).optional(),
    east: z.coerce.number().min(-180).max(180).optional(),
    west: z.coerce.number().min(-180).max(180).optional(),
    // Proximity filter. All three are required together.
    nearLat: z.coerce.number().min(-90).max(90).optional(),
    nearLng: z.coerce.number().min(-180).max(180).optional(),
    radiusKm: z.coerce.number().positive().max(MAX_RADIUS_KM).optional(),
    sort: z.enum(SITE_SORTS).default('name'),
    includeDeleted: z
      .union([z.boolean(), z.enum(['true', 'false'])])
      .transform((value) => value === true || value === 'true')
      .default(false),
    limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(500),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine(
    (query) => countDefined([query.nearLat, query.nearLng, query.radiusKm]) % 3 === 0,
    { message: 'nearLat, nearLng and radiusKm must be supplied together', path: ['radiusKm'] },
  )
  .refine(
    (query) => countDefined([query.north, query.south, query.east, query.west]) % 4 === 0,
    { message: 'north, south, east and west must be supplied together', path: ['north'] },
  )
  .refine((query) => query.sort !== 'distance' || query.nearLat !== undefined, {
    message: 'sort=distance requires nearLat, nearLng and radiusKm',
    path: ['sort'],
  });

function countDefined(values) {
  return values.filter((value) => value !== undefined).length;
}
