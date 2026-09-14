import { z } from 'zod';

const MAX_NOTE = 2000;
const MAX_LIMIT = 500;

const visitedAt = z.string().refine(isValidVisitDate, 'visitedAt must be an ISO date or datetime').refine(
  isNotFuture,
  'visitedAt must not be in the future',
).transform((value) => (/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Date(value).toISOString()));

const fields = {
  visitedAt,
  rating: z.coerce.number().int().min(1).max(5).nullable(),
  note: z.string().trim().max(MAX_NOTE),
};

export const createVisitSchema = z.object({
  visitedAt: fields.visitedAt,
  rating: fields.rating.optional().default(null),
  note: fields.note.optional().default(''),
});

export const updateVisitSchema = z
  .object(fields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Nothing to update');

export const visitIdSchema = z.object({ id: z.coerce.number().int().positive() });
export const siteVisitParamsSchema = z.object({ id: z.coerce.number().int().positive() });

export const listVisitsSchema = z.object({
  scope: z.enum(['mine', 'all']).optional(),
  userId: z.coerce.number().int().positive().optional(),
  siteId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export const listSiteVisitsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

function isValidVisitDate(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
  }
  return z.string().datetime({ offset: true }).safeParse(value).success;
}

function isNotFuture(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return Date.parse(value) <= Date.now();
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return value <= today;
}
