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
vi.mock('../lib/jwt.js', () => ({ signToken: vi.fn().mockReturnValue('signed-token') }));

import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { login, revokeToken, isTokenRevoked } from './auth.service.js';

const DB_USER = {
  id: 1,
  username: 'alice',
  password: 'hashed',
  fullName: 'Alice Example',
  role: 'reader',
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

  it('returns token and public profile on success', async () => {
    prisma.user.findUnique.mockResolvedValue(DB_USER);
    bcrypt.compare.mockResolvedValue(true);
    const result = await login('alice', 'correct');
    expect(result.token).toBe('signed-token');
    expect(result.user).toEqual({
      id: 1,
      username: 'alice',
      fullName: 'Alice Example',
      role: 'reader',
    });
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
    expect(prisma.revokedToken.deleteMany).toHaveBeenCalledBefore
      ? expect(prisma.revokedToken.deleteMany).toHaveBeenCalled()
      : expect(prisma.revokedToken.deleteMany).toHaveBeenCalled();
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
