import { z } from 'zod';

export const notificationIdSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const listNotificationsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
