export function notFound(req, res) {
  res.status(404).json({ ok: false, error: 'NOT_FOUND', path: req.originalUrl });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(error, req, res, next) {
  console.error('[api] unhandled error:', error);
  const status = error.status || 500;
  res.status(status).json({
    ok: false,
    error: error.code || 'INTERNAL_ERROR',
    message: error.publicMessage || 'Unexpected server error'
  });
}

/** Wraps async route handlers so rejections reach the error handler. */
export function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}
