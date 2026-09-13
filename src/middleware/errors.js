export class HttpError extends Error {
  constructor(status, message, details = undefined) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function notFoundHandler(req, res) {
  res.status(404).json({ ok: false, error: `No route for ${req.method} ${req.path}` });
}

// Express identifies error handlers by arity — keep all four params.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ ok: false, error: err.message, details: err.details });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ ok: false, error: 'Malformed JSON body' });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ ok: false, error: 'Request body too large' });
  }
  console.error(`[error] ${req.requestId ?? '-'} ${req.method} ${req.path}`, err);
  return res.status(500).json({ ok: false, error: 'Internal server error', requestId: req.requestId ?? null });
}
