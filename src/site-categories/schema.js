import { z } from 'zod';

const MAX_LABEL = 60;
// Slugs match the shape of the built-ins: lowercase letters, digits, underscores.
const SLUG = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9_]+$/, 'Slug may only contain lowercase letters, digits and underscores');
const COLOR = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a #rrggbb hex value');

export const createCategorySchema = z.object({
  slug: SLUG,
  label: z.string().trim().min(1).max(MAX_LABEL),
  color: COLOR,
});

export const updateCategorySchema = z
  .object({
    label: z.string().trim().min(1).max(MAX_LABEL),
    color: COLOR,
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Nothing to update');

export const categoryIdSchema = z.object({ id: z.coerce.number().int().positive() });
