import { z } from 'zod';
import { WORK_ORDER_PRIORITIES } from '../work-orders/schema.js';

const MAX_TITLE = 140;
const MAX_DESCRIPTION = 4000;
const MAX_INTERVAL_DAYS = 365 * 5;

/** Calendar day, `YYYY-MM-DD` — the same shape work-order due dates use. */
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'Not a real date');

const fields = {
  siteId: z.coerce.number().int().positive(),
  templateId: z.coerce.number().int().positive().nullable(),
  title: z.string().trim().min(1).max(MAX_TITLE),
  description: z.string().trim().max(MAX_DESCRIPTION),
  priority: z.enum(WORK_ORDER_PRIORITIES),
  assignedTo: z.coerce.number().int().positive().nullable(),
  intervalDays: z.coerce.number().int().min(1).max(MAX_INTERVAL_DAYS),
  nextDueDate: calendarDate,
  isActive: z.boolean(),
};

export const createScheduleSchema = z.object({
  ...fields,
  templateId: fields.templateId.default(null),
  description: fields.description.default(''),
  priority: fields.priority.default('normal'),
  assignedTo: fields.assignedTo.default(null),
}).omit({ isActive: true });

export const updateScheduleSchema = z
  .object(fields)
  .omit({ siteId: true })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Nothing to update');

export const scheduleIdSchema = z.object({ id: z.coerce.number().int().positive() });

export const listSchedulesSchema = z.object({
  siteId: z.coerce.number().int().positive().optional(),
  dueOnly: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .default(false),
  includeInactive: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .default(false),
});
