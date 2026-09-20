import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/auth.service.js', () => ({
  login: vi.fn(),
  revokeToken: vi.fn(),
  revokeRefreshToken: vi.fn(),
  refreshAccessToken: vi.fn(),
}));

import * as authService from '../services/auth.service.js';
import { login, logout, refresh } from './auth.controller.js';

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

  it('returns 200 with user, accessToken, refreshToken and expiresIn on success', async () => {
    const user = { id: 1, username: 'alice', fullName: 'Alice', role: 'reader', locale: 'en' };
    authService.login.mockResolvedValue({
      accessToken: 'acc-tok',
      refreshToken: 'ref-tok',
      expiresIn: 3600,
      user,
    });
    const res = mockRes();
    await login({ body: { username: 'alice', password: 'correct' } }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      user,
      accessToken: 'acc-tok',
      refreshToken: 'ref-tok',
      expiresIn: 3600,
    });
  });

  it('passes rememberMe boolean to authService.login', async () => {
    authService.login.mockResolvedValue({
      accessToken: 'acc',
      refreshToken: 'ref',
      expiresIn: 3600,
      user: { id: 1, username: 'alice', fullName: 'Alice', role: 'reader', locale: 'en' },
    });
    await login({ body: { username: 'alice', password: 'pass', rememberMe: true } }, mockRes(), vi.fn());
    expect(authService.login).toHaveBeenCalledWith('alice', 'pass', true);
  });

  it('returns 401 with accountDeactivated errorKey when service throws ACCOUNT_DEACTIVATED', async () => {
    const err = new Error('Account is deactivated');
    err.code = 'ACCOUNT_DEACTIVATED';
    authService.login.mockRejectedValue(err);
    const res = mockRes();
    await login({ body: { username: 'alice', password: 'pass' } }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      errorKey: 'login.accountDeactivated',
    });
  });

  it('calls next with the error when the service throws an unexpected error', async () => {
    const err = new Error('db error');
    authService.login.mockRejectedValue(err);
    const next = vi.fn();
    await login({ body: { username: 'alice', password: 'pass' } }, mockRes(), next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('logout controller', () => {
  it('revokes the access token from req.user and returns 200', async () => {
    authService.revokeToken.mockResolvedValue();
    const req = { user: { jti: 'jti-1', exp: 9999999 }, body: {} };
    const res = mockRes();
    await logout(req, res, vi.fn());
    expect(authService.revokeToken).toHaveBeenCalledWith('jti-1', 9999999);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('also revokes the refresh token when provided in the body', async () => {
    authService.revokeToken.mockResolvedValue();
    authService.revokeRefreshToken.mockResolvedValue();
    const req = { user: { jti: 'jti-1', exp: 9999999 }, body: { refreshToken: 'ref-tok' } };
    await logout(req, mockRes(), vi.fn());
    expect(authService.revokeRefreshToken).toHaveBeenCalledWith('ref-tok');
  });

  it('does not call revokeRefreshToken when no refreshToken in body', async () => {
    authService.revokeToken.mockResolvedValue();
    const req = { user: { jti: 'jti-1', exp: 9999999 }, body: {} };
    await logout(req, mockRes(), vi.fn());
    expect(authService.revokeRefreshToken).not.toHaveBeenCalled();
  });

  it('calls next with the error when revokeToken throws', async () => {
    const err = new Error('db error');
    authService.revokeToken.mockRejectedValue(err);
    const next = vi.fn();
    await logout({ user: { jti: 'jti-1', exp: 999 }, body: {} }, mockRes(), next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('refresh controller', () => {
  it('returns 401 when refreshToken is missing from body', async () => {
    const res = mockRes();
    await refresh({ body: {} }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 when body is absent', async () => {
    const res = mockRes();
    await refresh({ body: undefined }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 200 with new tokens on valid refresh token', async () => {
    authService.refreshAccessToken.mockResolvedValue({
      accessToken: 'new-acc',
      refreshToken: 'new-ref',
      expiresIn: 3600,
    });
    const req = { body: { refreshToken: 'raw-ref-tok' } };
    const res = mockRes();
    await refresh(req, res, vi.fn());
    expect(authService.refreshAccessToken).toHaveBeenCalledWith('raw-ref-tok');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      accessToken: 'new-acc',
      refreshToken: 'new-ref',
      expiresIn: 3600,
    });
  });

  it('returns 401 when refreshAccessToken throws INVALID_REFRESH_TOKEN', async () => {
    const err = new Error('Invalid');
    err.code = 'INVALID_REFRESH_TOKEN';
    authService.refreshAccessToken.mockRejectedValue(err);
    const res = mockRes();
    await refresh({ body: { refreshToken: 'bad' } }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('calls next with the error when refreshAccessToken throws an unexpected error', async () => {
    const err = new Error('db error');
    authService.refreshAccessToken.mockRejectedValue(err);
    const next = vi.fn();
    await refresh({ body: { refreshToken: 'tok' } }, mockRes(), next);
    expect(next).toHaveBeenCalledWith(err);
  });
});
