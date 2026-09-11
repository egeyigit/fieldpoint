import { z } from 'zod';

export const WORK_ORDER_STATUSES = ['open', 'in_progress', 'blocked', 'done', 'cancelled'];

// The single source of truth for how a work order may move between statuses.
// A status maps to the set of statuses it is allowed to become; staying put is
// always permitted and handled by the caller.
export const STATUS_TRANSITIONS = {
  open: ['in_progress', 'blocked', 'done', 'cancelled'],
  in_progress: ['open', 'blocked', 'done', 'cancelled'],
  blocked: ['open', 'in_progress', 'done', 'cancelled'],
  // Terminal statuses reopen only into the unfinished states.
  done: ['open', 'in_progress', 'blocked'],
  cancelled: ['open', 'in_progress', 'blocked'],
};

// Reopening a terminal order is a meaningful event, not a routine edit.
export const TERMINAL_STATUSES = ['done', 'cancelled'];

export function isStatusTransitionAllowed(from, to) {
  if (from === to) return true;
  return (STATUS_TRANSITIONS[from] ?? []).includes(to);
}
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
};

export const createWorkOrderSchema = z.object({
  ...fields,
  description: fields.description.default(''),
  status: fields.status.default('open'),
  priority: fields.priority.default('normal'),
  assignedTo: fields.assignedTo.default(null),
  dueDate: fields.dueDate.default(null),
});

export const updateWorkOrderSchema = z
  .object({ ...fields })
  .omit({ siteId: true })
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
