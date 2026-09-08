import { Router } from 'express';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { validate } from '../middleware/validate.js';
import { HttpError } from '../middleware/errors.js';
import { recordAudit } from '../audit/log.js';
import { createSiteSchema, listSitesSchema, siteIdSchema, updateSiteSchema } from './schema.js';
import { toCsv } from './csv.js';
import { parseSingleFile } from './attachments/multipart.js';
import { sniffType } from './attachments/sniff.js';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export function createSiteRouter({ db, sites, attachments }) {
  const router = Router();
  router.use(requireAuth);

  router.get('/', validate(listSitesSchema, 'query'), (req, res) => {
    const { rows, total } = sites.list(req.validated.query);
    res.json({ ok: true, sites: rows, total, limit: req.validated.query.limit, offset: req.validated.query.offset });
  });

  router.get('/stats', (_req, res) => {
    res.json({ ok: true, stats: sites.stats() });
  });

  router.get('/export.csv', validate(listSitesSchema, 'query'), (req, res) => {
    const rows = sites.listAll(req.validated.query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="sites.csv"');
    res.send(toCsv(rows));
  });

  router.get('/:id', validate(siteIdSchema, 'params'), (req, res, next) => {
    const site = sites.findById(req.validated.params.id);
    if (!site) return next(new HttpError(404, 'Site not found'));
    return res.json({ ok: true, site });
  });

  router.post('/', validate(createSiteSchema), (req, res) => {
    const site = sites.create(req.validated.body, req.user.id);
    recordAudit(db, { userId: req.user.id, action: 'site.create', entityType: 'site', entityId: site.id, details: { name: site.name } });
    res.status(201).json({ ok: true, site });
  });

  router.put('/:id', validate(siteIdSchema, 'params'), validate(updateSiteSchema), (req, res, next) => {
    const { id } = req.validated.params;
    if (!sites.findById(id)) return next(new HttpError(404, 'Site not found'));
    const site = sites.update(id, req.validated.body, req.user.id);
    recordAudit(db, { userId: req.user.id, action: 'site.update', entityType: 'site', entityId: id, details: req.validated.body });
    return res.json({ ok: true, site });
  });

  router.delete('/:id', requireRole('admin'), validate(siteIdSchema, 'params'), (req, res, next) => {
    const { id } = req.validated.params;
    const existing = sites.findById(id);
    if (!existing) return next(new HttpError(404, 'Site not found'));
    attachments.removeFilesForSite(id);
    sites.remove(id);
    recordAudit(db, { userId: req.user.id, action: 'site.delete', entityType: 'site', entityId: id, details: { name: existing.name } });
    return res.status(204).end();
  });

  router.get('/:id/attachments', validate(siteIdSchema, 'params'), (req, res, next) => {
    const { id } = req.validated.params;
    if (!sites.findById(id)) return next(new HttpError(404, 'Site not found'));
    return res.json({ ok: true, attachments: attachments.listForSite(id) });
  });

  router.post('/:id/attachments', validate(siteIdSchema, 'params'), async (req, res, next) => {
    const { id } = req.validated.params;
    try {
      if (!sites.findById(id)) throw new HttpError(404, 'Site not found');
      const file = await parseSingleFile(req, { maxBytes: MAX_UPLOAD_BYTES });
      const realType = sniffType(file.data);
      if (!realType) throw new HttpError(415, 'Unsupported file type');
      const clean = file.filename ? file.filename.replace(/[\r\n"]/g, '').slice(0, 255) : 'file';
      const attachment = attachments.create({
        siteId: id,
        filename: clean || 'file',
        mimeType: realType,
        data: file.data,
        uploadedBy: req.user.id,
      });
      recordAudit(db, { userId: req.user.id, action: 'attachment.create', entityType: 'site', entityId: id, details: { attachmentId: attachment.id, filename: attachment.filename } });
      return res.status(201).json({ ok: true, attachment });
    } catch (error) {
      return next(error);
    }
  });

  router.get('/:id/attachments/:attachmentId', validate(siteIdSchema, 'params'), (req, res, next) => {
    const siteId = req.validated.params.id;
    const attachmentId = Number.parseInt(req.params.attachmentId, 10);
    if (!Number.isInteger(attachmentId)) return next(new HttpError(404, 'Attachment not found'));
    const attachment = attachments.find(attachmentId, siteId);
    if (!attachment) return next(new HttpError(404, 'Attachment not found'));
    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${attachment.filename.replace(/"/g, '')}"`);
    return res.send(attachments.readFile(attachment));
  });

  router.delete('/:id/attachments/:attachmentId', requireRole('admin'), validate(siteIdSchema, 'params'), (req, res, next) => {
    const siteId = req.validated.params.id;
    const attachmentId = Number.parseInt(req.params.attachmentId, 10);
    if (!Number.isInteger(attachmentId)) return next(new HttpError(404, 'Attachment not found'));
    const attachment = attachments.find(attachmentId, siteId);
    if (!attachment) return next(new HttpError(404, 'Attachment not found'));
    attachments.remove(attachment);
    recordAudit(db, { userId: req.user.id, action: 'attachment.delete', entityType: 'site', entityId: siteId, details: { attachmentId } });
    return res.status(204).end();
  });

  return router;
}
