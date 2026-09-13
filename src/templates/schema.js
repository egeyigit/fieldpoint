import { z } from 'zod';
import { WORK_ORDER_PRIORITIES } from '../work-orders/schema.js';

const MAX_NAME = 80;
const MAX_TITLE = 140;
const MAX_DESCRIPTION = 4000;
const MAX_ITEM = 200;
const MAX_ITEMS = 100;
const MAX_MINUTES = 60 * 24 * 30;

const checklist = z.array(z.string().trim().min(1).max(MAX_ITEM)).max(MAX_ITEMS);

const fields = {
  name: z.string().trim().min(1).max(MAX_NAME),
  title: z.string().trim().min(1).max(MAX_TITLE),
  description: z.string().trim().max(MAX_DESCRIPTION),
  priority: z.enum(WORK_ORDER_PRIORITIES),
  estimatedMinutes: z.coerce.number().int().positive().max(MAX_MINUTES).nullable(),
  isArchived: z.boolean(),
  items: checklist,
};

export const createTemplateSchema = z.object({
  ...fields,
  description: fields.description.default(''),
  priority: fields.priority.default('normal'),
  estimatedMinutes: fields.estimatedMinutes.default(null),
  items: fields.items.default([]),
}).omit({ isArchived: true });

export const updateTemplateSchema = z
  .object(fields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Nothing to update');

export const templateIdSchema = z.object({ id: z.coerce.number().int().positive() });

export const listTemplatesSchema = z.object({
  includeArchived: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .default(false),
});
