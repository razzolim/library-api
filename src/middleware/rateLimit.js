// Minimal in-memory fixed-window limiter, keyed by authenticated user id. Per-process state is
// enough for a single instance; swap for a shared store if the API is ever scaled out.
export function rateLimitPerUser({ max, windowMs }) {
  const hits = new Map();

  return (req, res, next) => {
    const now = Date.now();
    const key = req.user.sub;
    const entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    entry.count += 1;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ success: false, errorKey: 'admin.rateLimited' });
    }
    return next();
  };
}
