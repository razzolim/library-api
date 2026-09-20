import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    revokedToken: {
      deleteMany: vi.fn(),
      upsert: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));
vi.mock('bcryptjs', () => ({ default: { compare: vi.fn() } }));
vi.mock('../lib/jwt.js', () => ({
  signAccessToken: vi.fn().mockReturnValue('access-token'),
  signRefreshToken: vi.fn().mockReturnValue('refresh-token'),
  verifyToken: vi.fn(),
  decodeToken: vi.fn().mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 3600 }),
}));

import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { signAccessToken, signRefreshToken, verifyToken } from '../lib/jwt.js';
import { login, revokeToken, isTokenRevoked, refreshAccessToken } from './auth.service.js';

const DB_USER = {
  id: 1,
  username: 'alice',
  password: 'hashed',
  fullName: 'Alice Example',
  role: 'reader',
  isActive: true,
  locale: 'en',
};

beforeEach(() => vi.clearAllMocks());

describe('login', () => {
  it('returns null when the user is not found', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    expect(await login('nobody', 'pass')).toBeNull();
  });

  it('returns null when the password does not match', async () => {
    prisma.user.findUnique.mockResolvedValue(DB_USER);
    bcrypt.compare.mockResolvedValue(false);
    expect(await login('alice', 'wrong')).toBeNull();
  });

  it('throws ACCOUNT_DEACTIVATED when the user is inactive', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...DB_USER, isActive: false });
    await expect(login('alice', 'correct')).rejects.toMatchObject({ code: 'ACCOUNT_DEACTIVATED' });
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });

  it('returns accessToken, refreshToken and public profile on success', async () => {
    prisma.user.findUnique.mockResolvedValue(DB_USER);
    bcrypt.compare.mockResolvedValue(true);
    const result = await login('alice', 'correct');
    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toBe('refresh-token');
    expect(typeof result.expiresIn).toBe('number');
    expect(result.user).toEqual({
      id: 1,
      username: 'alice',
      fullName: 'Alice Example',
      role: 'reader',
      locale: 'en',
    });
  });

  it('passes rememberMe to signRefreshToken', async () => {
    prisma.user.findUnique.mockResolvedValue(DB_USER);
    bcrypt.compare.mockResolvedValue(true);
    await login('alice', 'correct', true);
    expect(signRefreshToken).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 1, username: 'alice', role: 'reader' }),
      true,
    );
  });

  it('never includes the password in the returned user', async () => {
    prisma.user.findUnique.mockResolvedValue(DB_USER);
    bcrypt.compare.mockResolvedValue(true);
    const result = await login('alice', 'correct');
    expect(result.user).not.toHaveProperty('password');
  });
});

describe('revokeToken', () => {
  it('prunes already-expired tokens before inserting the new one', async () => {
    prisma.revokedToken.deleteMany.mockResolvedValue({});
    prisma.revokedToken.upsert.mockResolvedValue({});
    const exp = Math.floor(Date.now() / 1000) + 3600;
    await revokeToken('some-jti', exp);
    expect(prisma.revokedToken.deleteMany).toHaveBeenCalled();
    expect(prisma.revokedToken.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { jti: 'some-jti' } })
    );
  });

  it('upserts the jti with an expiresAt derived from the exp claim', async () => {
    prisma.revokedToken.deleteMany.mockResolvedValue({});
    prisma.revokedToken.upsert.mockResolvedValue({});
    const exp = 1000000;
    await revokeToken('jti-abc', exp);
    const call = prisma.revokedToken.upsert.mock.calls[0][0];
    expect(call.create.expiresAt).toEqual(new Date(exp * 1000));
  });
});

describe('isTokenRevoked', () => {
  it('returns true when the jti exists in the denylist', async () => {
    prisma.revokedToken.findUnique.mockResolvedValue({ jti: 'jti-1' });
    expect(await isTokenRevoked('jti-1')).toBe(true);
  });

  it('returns false when the jti is not in the denylist', async () => {
    prisma.revokedToken.findUnique.mockResolvedValue(null);
    expect(await isTokenRevoked('jti-unknown')).toBe(false);
  });
});

describe('refreshAccessToken', () => {
  const REFRESH_PAYLOAD = {
    sub: 1,
    username: 'alice',
    role: 'reader',
    type: 'refresh',
    rememberMe: false,
    jti: 'refresh-jti',
    exp: Math.floor(Date.now() / 1000) + 7200,
  };

  beforeEach(() => {
    prisma.revokedToken.deleteMany.mockResolvedValue({});
    prisma.revokedToken.upsert.mockResolvedValue({});
    prisma.revokedToken.findUnique.mockResolvedValue(null);
    verifyToken.mockReturnValue(REFRESH_PAYLOAD);
  });

  it('revokes the old refresh jti and returns new tokens', async () => {
    const result = await refreshAccessToken('raw-refresh-token');
    expect(prisma.revokedToken.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { jti: 'refresh-jti' } })
    );
    expect(result.accessToken).toBe('access-token');
    expect(result.refreshToken).toBe('refresh-token');
  });

  it('throws INVALID_REFRESH_TOKEN when verifyToken throws', async () => {
    verifyToken.mockImplementation(() => { throw new Error('bad'); });
    await expect(refreshAccessToken('bad-token')).rejects.toMatchObject({ code: 'INVALID_REFRESH_TOKEN' });
  });

  it('throws INVALID_REFRESH_TOKEN when the token is not a refresh type', async () => {
    verifyToken.mockReturnValue({ ...REFRESH_PAYLOAD, type: 'access' });
    await expect(refreshAccessToken('wrong-type')).rejects.toMatchObject({ code: 'INVALID_REFRESH_TOKEN' });
  });

  it('throws INVALID_REFRESH_TOKEN when the refresh token is revoked', async () => {
    prisma.revokedToken.findUnique.mockResolvedValue({ jti: 'refresh-jti' });
    await expect(refreshAccessToken('revoked-token')).rejects.toMatchObject({ code: 'INVALID_REFRESH_TOKEN' });
  });

  it('passes rememberMe from the refresh token payload to signRefreshToken', async () => {
    verifyToken.mockReturnValue({ ...REFRESH_PAYLOAD, rememberMe: true });
    await refreshAccessToken('raw-refresh-token');
    expect(signRefreshToken).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 1 }),
      true,
    );
  });
});
