import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { validate } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';
import { listNotificationsSchema, notificationIdSchema } from './schema.js';

export function createNotificationRouter({ notifications }) {
  const router = Router();
  router.use(requireAuth);

  router.get('/', validate(listNotificationsSchema, 'query'), (req, res) => {
    const { notifications: rows, unread } = notifications.listForUser(req.user.id, req.validated.query.limit);
    res.json({ ok: true, notifications: rows, unread });
  });

  router.post('/:id/read', validate(notificationIdSchema, 'params'), (req, res, next) => {
    // Owner-scoped: another user's notification id must not leak, so it 404s.
    const outcome = notifications.markRead(req.validated.params.id, req.user.id);
    if (outcome === 'not_found') return next(new HttpError(404, 'Notification not found'));
    return res.json({ ok: true, unread: notifications.unreadCount(req.user.id) });
  });

  return router;
}
