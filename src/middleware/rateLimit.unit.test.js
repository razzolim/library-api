import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rateLimitPerUser } from './rateLimit.js';

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.set = vi.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('rateLimitPerUser', () => {
  it('allows up to max requests then returns 429 with Retry-After', () => {
    const limiter = rateLimitPerUser({ max: 2, windowMs: 60_000 });
    const next = vi.fn();
    limiter({ user: { sub: 1 } }, mockRes(), next);
    limiter({ user: { sub: 1 } }, mockRes(), next);
    expect(next).toHaveBeenCalledTimes(2);

    const res = mockRes();
    limiter({ user: { sub: 1 } }, res, next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.set).toHaveBeenCalledWith('Retry-After', '60');
  });

  it('counts each user separately', () => {
    const limiter = rateLimitPerUser({ max: 1, windowMs: 60_000 });
    const next = vi.fn();
    limiter({ user: { sub: 1 } }, mockRes(), next);
    limiter({ user: { sub: 2 } }, mockRes(), next);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it('resets after the window elapses', () => {
    const limiter = rateLimitPerUser({ max: 1, windowMs: 60_000 });
    const next = vi.fn();
    limiter({ user: { sub: 1 } }, mockRes(), next);
    vi.advanceTimersByTime(60_001);
    limiter({ user: { sub: 1 } }, mockRes(), next);
    expect(next).toHaveBeenCalledTimes(2);
  });
});
