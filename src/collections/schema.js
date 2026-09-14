import { z } from 'zod';

const fields = {
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500),
};

export const emptyQuerySchema = z.object({});

export const createCollectionSchema = z.object({
  name: fields.name,
  description: fields.description.optional().default(''),
});

export const updateCollectionSchema = z
  .object(fields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Nothing to update');

export const collectionIdSchema = z.object({ id: z.coerce.number().int().positive() });
export const collectionSiteParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  siteId: z.coerce.number().int().positive(),
});

export const shareTokenSchema = z.object({
  token: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/, 'Invalid share token'),
});
