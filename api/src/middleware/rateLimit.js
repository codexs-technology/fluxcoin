/**
 * Tiny in-memory sliding-window rate limiter (no external dependency).
 * Use Redis instead when you run more than one API instance.
 */
const buckets = new Map();

export function rateLimit({ windowMs = 60_000, max = 30, keyPrefix = 'global' } = {}) {
  return (req, res, next) => {
    const identity = req.address || req.ip || 'unknown';
    const key = `${keyPrefix}:${identity}`;
    const now = Date.now();
    const hits = (buckets.get(key) || []).filter((timestamp) => now - timestamp < windowMs);

    if (hits.length >= max) {
      const retryAfterMs = windowMs - (now - hits[0]);
      res.setHeader('Retry-After', Math.ceil(retryAfterMs / 1000));
      return res.status(429).json({
        ok: false,
        error: 'RATE_LIMITED',
        message: `Too many requests, retry in ${Math.ceil(retryAfterMs / 1000)}s`
      });
    }

    hits.push(now);
    buckets.set(key, hits);
    return next();
  };
}

/** Periodic cleanup so the map cannot grow forever. */
export function pruneRateLimitBuckets() {
  const now = Date.now();
  for (const [key, hits] of buckets.entries()) {
    const fresh = hits.filter((timestamp) => now - timestamp < 10 * 60_000);
    if (fresh.length === 0) buckets.delete(key);
    else buckets.set(key, fresh);
  }
}
