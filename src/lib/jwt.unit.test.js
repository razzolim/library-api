import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { signToken, verifyToken } from './jwt.js';

const ORIGINAL_SECRET = process.env.JWT_SECRET;

beforeEach(() => {
  process.env.JWT_SECRET = 'unit-test-secret';
  process.env.JWT_EXPIRES_IN = '1h';
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.JWT_SECRET;
  } else {
    process.env.JWT_SECRET = ORIGINAL_SECRET;
  }
});

describe('signToken', () => {
  it('produces a token that round-trips through verifyToken', () => {
    const token = signToken({ sub: 1, username: 'alice', role: 'reader' });
    const decoded = verifyToken(token);
    expect(decoded.sub).toBe(1);
    expect(decoded.username).toBe('alice');
    expect(decoded.role).toBe('reader');
  });

  it('injects a unique jti on every call', () => {
    const d1 = verifyToken(signToken({ sub: 1 }));
    const d2 = verifyToken(signToken({ sub: 1 }));
    expect(d1.jti).toBeDefined();
    expect(d1.jti).not.toBe(d2.jti);
  });

  it('throws when JWT_SECRET is not set', () => {
    delete process.env.JWT_SECRET;
    expect(() => signToken({ sub: 1 })).toThrow('JWT_SECRET');
  });
});

describe('verifyToken', () => {
  it('returns the decoded payload for a valid token', () => {
    const token = signToken({ sub: 42, role: 'admin' });
    const payload = verifyToken(token);
    expect(payload.sub).toBe(42);
    expect(payload.role).toBe('admin');
  });

  it('throws for a malformed token', () => {
    expect(() => verifyToken('not.a.jwt')).toThrow();
  });

  it('throws for a token signed with a different secret', () => {
    const token = signToken({ sub: 1 });
    process.env.JWT_SECRET = 'different-secret';
    expect(() => verifyToken(token)).toThrow();
  });

  it('throws when JWT_SECRET is not set', () => {
    const token = signToken({ sub: 1 });
    delete process.env.JWT_SECRET;
    expect(() => verifyToken(token)).toThrow('JWT_SECRET');
  });
});
