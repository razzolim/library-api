import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/jwt.js', () => ({ verifyToken: vi.fn() }));
vi.mock('../services/auth.service.js', () => ({ isTokenRevoked: vi.fn() }));

import { verifyToken } from '../lib/jwt.js';
import { isTokenRevoked } from '../services/auth.service.js';
import { authenticate } from './auth.js';

const PAYLOAD = { sub: 1, username: 'alice', role: 'reader', jti: 'test-jti' };

function mockReq(authHeader) {
  return { headers: authHeader !== undefined ? { authorization: authHeader } : {} };
}

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  verifyToken.mockReturnValue(PAYLOAD);
  isTokenRevoked.mockResolvedValue(false);
});

describe('authenticate middleware', () => {
  it('returns 401 when Authorization header is absent', async () => {
    const res = mockRes();
    await authenticate(mockReq(undefined), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 when Authorization header is not Bearer', async () => {
    const res = mockRes();
    await authenticate(mockReq('Basic sometoken'), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 when verifyToken throws', async () => {
    verifyToken.mockImplementation(() => { throw new Error('invalid'); });
    const res = mockRes();
    await authenticate(mockReq('Bearer bad-token'), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 when the token is revoked', async () => {
    isTokenRevoked.mockResolvedValue(true);
    const res = mockRes();
    await authenticate(mockReq('Bearer valid-token'), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('calls next with the error when isTokenRevoked rejects', async () => {
    const dbError = new Error('db down');
    isTokenRevoked.mockRejectedValue(dbError);
    const next = vi.fn();
    await authenticate(mockReq('Bearer valid-token'), mockRes(), next);
    expect(next).toHaveBeenCalledWith(dbError);
  });

  it('attaches the payload to req.user and calls next() for a valid token', async () => {
    const req = mockReq('Bearer valid-token');
    const next = vi.fn();
    await authenticate(req, mockRes(), next);
    expect(req.user).toEqual(PAYLOAD);
    expect(next).toHaveBeenCalledWith();
  });

  it('passes the raw token string to verifyToken', async () => {
    await authenticate(mockReq('Bearer my-token'), mockRes(), vi.fn());
    expect(verifyToken).toHaveBeenCalledWith('my-token');
  });
});
