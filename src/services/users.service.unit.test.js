import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
  },
}));
vi.mock('bcryptjs', () => ({ default: { compare: vi.fn(), hash: vi.fn() } }));

import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { changePassword } from './users.service.js';

const DB_USER = { id: 1, username: 'alice', password: 'hashed', fullName: 'Alice', role: 'reader' };

beforeEach(() => vi.clearAllMocks());

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
