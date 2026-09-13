import { z } from 'zod';

export const WORK_ORDER_STATUSES = ['open', 'in_progress', 'blocked', 'done', 'cancelled'];
export const WORK_ORDER_PRIORITIES = ['low', 'normal', 'high', 'urgent'];
export const WORK_ORDER_SORTS = ['due', 'priority', 'created', 'updated'];
export const OPEN_STATUSES = ['open', 'in_progress', 'blocked'];

const MAX_TITLE = 140;
const MAX_DESCRIPTION = 4000;
const MAX_COMMENT = 2000;
const MAX_LIMIT = 500;

/** Calendar day, `YYYY-MM-DD`. Kept as a string so no timezone can shift it. */
const dueDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Due date must be YYYY-MM-DD')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'Due date is not a real date')
  .nullable();

const fields = {
  siteId: z.coerce.number().int().positive(),
  title: z.string().trim().min(1).max(MAX_TITLE),
  description: z.string().trim().max(MAX_DESCRIPTION),
  status: z.enum(WORK_ORDER_STATUSES),
  priority: z.enum(WORK_ORDER_PRIORITIES),
  assignedTo: z.coerce.number().int().positive().nullable(),
  dueDate,
  templateId: z.coerce.number().int().positive().nullable(),
  estimatedMinutes: z.coerce.number().int().positive().max(60 * 24 * 30).nullable(),
};

const MAX_NOTE = 500;

export const createChecklistItemSchema = z.object({
  text: z.string().trim().min(1).max(200),
});

export const setChecklistItemSchema = z.object({ isDone: z.boolean() });

export const checklistItemIdSchema = z.object({
  id: z.coerce.number().int().positive(),
  itemId: z.coerce.number().int().positive(),
});

export const timeLogIdSchema = z.object({
  id: z.coerce.number().int().positive(),
  logId: z.coerce.number().int().positive(),
});

export const stopTimerSchema = z.object({
  note: z.string().trim().max(MAX_NOTE).default(''),
});

/** An entry typed in after the fact; the end must not precede the start. */
export const manualTimeLogSchema = z
  .object({
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime(),
    note: z.string().trim().max(MAX_NOTE).default(''),
  })
  .refine((body) => Date.parse(body.endedAt) >= Date.parse(body.startedAt), {
    message: 'endedAt must not be before startedAt',
    path: ['endedAt'],
  });

export const createWorkOrderSchema = z.object({
  ...fields,
  description: fields.description.default(''),
  status: fields.status.default('open'),
  priority: fields.priority.default('normal'),
  assignedTo: fields.assignedTo.default(null),
  dueDate: fields.dueDate.default(null),
  templateId: fields.templateId.default(null),
  estimatedMinutes: fields.estimatedMinutes.default(null),
});

export const updateWorkOrderSchema = z
  .object({ ...fields })
  .omit({ siteId: true, templateId: true })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Nothing to update');

export const workOrderIdSchema = z.object({ id: z.coerce.number().int().positive() });

export const listWorkOrdersSchema = z.object({
  siteId: z.coerce.number().int().positive().optional(),
  status: z.enum(WORK_ORDER_STATUSES).optional(),
  priority: z.enum(WORK_ORDER_PRIORITIES).optional(),
  assignedTo: z.coerce.number().int().positive().optional(),
  // `open` collapses the three unfinished statuses; handy for the default view.
  openOnly: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .default(false),
  overdue: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .default(false),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(WORK_ORDER_SORTS).default('due'),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(200),
  offset: z.coerce.number().int().min(0).default(0),
});

export const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(MAX_COMMENT),
});
