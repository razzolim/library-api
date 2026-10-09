import { describe, it, expect, vi, beforeEach } from 'vitest';

const tx = vi.hoisted(() => ({ user: { update: vi.fn() } }));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    $transaction: vi.fn((fn) => fn(tx)),
  },
}));
vi.mock('./audit.service.js', () => ({ recordAudit: vi.fn() }));
vi.mock('bcryptjs', () => ({ default: { compare: vi.fn(), hash: vi.fn() } }));

import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { recordAudit } from './audit.service.js';
import { changePassword, createUser, deactivateUser, isSessionValid, resetPasswordAsAdmin } from './users.service.js';

const DB_USER = {
  id: 1,
  username: 'alice',
  password: 'hashed',
  fullName: 'Alice',
  role: 'reader',
  isActive: true,
};

beforeEach(() => vi.clearAllMocks());

describe('isSessionValid', () => {
  it('returns true when user is active and has no cutoff', async () => {
    prisma.user.findUnique.mockResolvedValue({ isActive: true, sessionsValidAfter: null });
    expect(await isSessionValid(1, 1000)).toBe(true);
  });

  it('returns false when user is inactive', async () => {
    prisma.user.findUnique.mockResolvedValue({ isActive: false, sessionsValidAfter: null });
    expect(await isSessionValid(1, 1000)).toBe(false);
  });

  it('returns false when user is not found', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    expect(await isSessionValid(99, 1000)).toBe(false);
  });

  it('returns false for a token issued at or before the cutoff', async () => {
    prisma.user.findUnique.mockResolvedValue({ isActive: true, sessionsValidAfter: new Date(1000_500) });
    expect(await isSessionValid(1, 1000)).toBe(false);
    expect(await isSessionValid(1, 999)).toBe(false);
  });

  it('returns true for a token issued after the cutoff', async () => {
    prisma.user.findUnique.mockResolvedValue({ isActive: true, sessionsValidAfter: new Date(1000_500) });
    expect(await isSessionValid(1, 1001)).toBe(true);
  });
});

describe('resetPasswordAsAdmin', () => {
  const ACTOR = { sub: 2, username: 'boss' };

  it('throws USER_NOT_FOUND for an unknown username', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(resetPasswordAsAdmin(ACTOR, 'ghost', 'long-enough')).rejects.toMatchObject({
      code: 'USER_NOT_FOUND',
    });
  });

  it('throws USE_ACCOUNT_PAGE when the admin targets themself', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...DB_USER, id: 2 });
    await expect(resetPasswordAsAdmin(ACTOR, 'boss', 'long-enough')).rejects.toMatchObject({
      code: 'USE_ACCOUNT_PAGE',
    });
  });

  it('hashes the password, sets the session cutoff and writes an audit entry', async () => {
    prisma.user.findUnique.mockResolvedValue(DB_USER);
    bcrypt.hash.mockResolvedValue('new-hash');
    const result = await resetPasswordAsAdmin(ACTOR, 'alice', 'long-enough', { ip: '1.1.1.1' });

    expect(result).toEqual({ username: 'alice' });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { password: 'new-hash', sessionsValidAfter: expect.any(Date) },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ actorUserId: 2, action: 'user.password.reset', targetId: 1, ip: '1.1.1.1' }),
    );
  });
});

describe('createUser', () => {
  it('throws USERNAME_TAKEN when username already exists', async () => {
    prisma.user.findUnique.mockResolvedValue(DB_USER);
    await expect(createUser('alice', 'pass', 'Alice')).rejects.toMatchObject({ code: 'USERNAME_TAKEN' });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('hashes the password and creates the user', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    bcrypt.hash.mockResolvedValue('hashed-pass');
    prisma.user.create.mockResolvedValue({
      id: 2,
      username: 'bob',
      fullName: 'Bob',
      role: 'reader',
    });

    const result = await createUser('bob', 'plain', 'Bob');

    expect(bcrypt.hash).toHaveBeenCalledWith('plain', 12);
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: { username: 'bob', password: 'hashed-pass', fullName: 'Bob', role: 'reader' },
    });
    expect(result).toEqual({ id: 2, username: 'bob', fullName: 'Bob', role: 'reader' });
  });

  it('never exposes the password in the returned profile', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    bcrypt.hash.mockResolvedValue('hashed-pass');
    prisma.user.create.mockResolvedValue({
      id: 2,
      username: 'bob',
      password: 'hashed-pass',
      fullName: 'Bob',
      role: 'reader',
    });

    const result = await createUser('bob', 'plain', 'Bob');
    expect(result).not.toHaveProperty('password');
  });
});

describe('deactivateUser', () => {
  it('throws USER_NOT_FOUND when target does not exist', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(deactivateUser(99)).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('throws CANNOT_DEACTIVATE_ADMIN when target is an admin', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...DB_USER, role: 'admin' });
    await expect(deactivateUser(1)).rejects.toMatchObject({ code: 'CANNOT_DEACTIVATE_ADMIN' });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('sets isActive to false for a reader user', async () => {
    prisma.user.findUnique.mockResolvedValue(DB_USER);
    prisma.user.update.mockResolvedValue({});

    await deactivateUser(1);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { isActive: false },
    });
  });
});

describe('changePassword', () => {
  it('throws WRONG_PASSWORD when the user is not found', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(changePassword(99, 'any', 'new')).rejects.toMatchObject({ code: 'WRONG_PASSWORD' });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('throws WRONG_PASSWORD when the current password does not match', async () => {
    prisma.user.findUnique.mockResolvedValue(DB_USER);
    bcrypt.compare.mockResolvedValue(false);
    await expect(changePassword(1, 'wrong', 'new')).rejects.toMatchObject({ code: 'WRONG_PASSWORD' });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('hashes the new password and updates the user on success', async () => {
    prisma.user.findUnique.mockResolvedValue(DB_USER);
    bcrypt.compare.mockResolvedValue(true);
    bcrypt.hash.mockResolvedValue('new-hashed');
    prisma.user.update.mockResolvedValue({});

    await changePassword(1, 'correct', 'new-pass');

    expect(bcrypt.hash).toHaveBeenCalledWith('new-pass', 12);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { password: 'new-hashed' },
    });
  });

  it('does not store the plaintext new password', async () => {
    prisma.user.findUnique.mockResolvedValue(DB_USER);
    bcrypt.compare.mockResolvedValue(true);
    bcrypt.hash.mockResolvedValue('hashed-new');
    prisma.user.update.mockResolvedValue({});

    await changePassword(1, 'correct', 'new-pass');

    const updateCall = prisma.user.update.mock.calls[0][0];
    expect(updateCall.data.password).not.toBe('new-pass');
    expect(updateCall.data.password).toBe('hashed-new');
  });
});
