import { tooMany } from './errors.js';

// Fixed-window in-memory limiter. Good enough for a single instance; move to a
// shared store before running more than one API process.
const buckets = new Map();

export function rateLimit({ key, limit, windowMs }) {
  return (req, _res, next) => {
    const id = `${key}:${req.ip}`;
    const t = Date.now();
    const bucket = buckets.get(id);
    if (!bucket || bucket.resetAt <= t) {
      buckets.set(id, { count: 1, resetAt: t + windowMs });
      return next();
    }
    bucket.count += 1;
    if (bucket.count > limit) return next(tooMany());
    next();
  };
}

export function resetRateLimits() {
  buckets.clear();
}
