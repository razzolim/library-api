import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/auth.service.js', () => ({
  login: vi.fn(),
  revokeToken: vi.fn(),
}));

import * as authService from '../services/auth.service.js';
import { login, logout } from './auth.controller.js';

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => vi.clearAllMocks());

describe('login controller', () => {
  it('returns 401 when username is missing', async () => {
    const res = mockRes();
    await login({ body: { password: 'pass' } }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, errorKey: 'login.invalidCredentials' })
    );
  });

  it('returns 401 when password is missing', async () => {
    const res = mockRes();
    await login({ body: { username: 'alice' } }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 when body is absent', async () => {
    const res = mockRes();
    await login({ body: undefined }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 when authService.login returns null', async () => {
    authService.login.mockResolvedValue(null);
    const res = mockRes();
    await login({ body: { username: 'alice', password: 'wrong' } }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 200 with user and token on success', async () => {
    const user = { id: 1, username: 'alice', fullName: 'Alice', role: 'reader' };
    authService.login.mockResolvedValue({ token: 'tok', user });
    const res = mockRes();
    await login({ body: { username: 'alice', password: 'correct' } }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, user, token: 'tok' });
  });

  it('calls next with the error when the service throws', async () => {
    const err = new Error('db error');
    authService.login.mockRejectedValue(err);
    const next = vi.fn();
    await login({ body: { username: 'alice', password: 'pass' } }, mockRes(), next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('logout controller', () => {
  it('revokes the token from req.user and returns 200', async () => {
    authService.revokeToken.mockResolvedValue();
    const req = { user: { jti: 'jti-1', exp: 9999999 } };
    const res = mockRes();
    await logout(req, res, vi.fn());
    expect(authService.revokeToken).toHaveBeenCalledWith('jti-1', 9999999);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('calls next with the error when revokeToken throws', async () => {
    const err = new Error('db error');
    authService.revokeToken.mockRejectedValue(err);
    const next = vi.fn();
    await logout({ user: { jti: 'jti-1', exp: 999 } }, mockRes(), next);
    expect(next).toHaveBeenCalledWith(err);
  });
});
