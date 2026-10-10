import { describe, it, expect, vi, beforeEach } from 'vitest';

const tx = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  user: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: { $transaction: vi.fn((fn) => fn(tx)), $queryRaw: vi.fn() },
}));
vi.mock('./audit.service.js', () => ({ recordAudit: vi.fn() }));

import { recordAudit } from './audit.service.js';
import { deleteUser, parseListParams, updateUser, validateUserUpdate } from './adminUsers.service.js';

const ACTOR = { sub: 1, username: 'boss' };
const TARGET = {
  id: 3, username: 'alice', fullName: 'Alice', email: 'a@x.org', role: 'reader', isActive: true, password: 'hash',
};

beforeEach(() => {
  vi.clearAllMocks();
  tx.$queryRaw.mockResolvedValue([{ id: 1 }]);
  tx.user.findUnique.mockResolvedValue(TARGET);
  tx.user.findFirst.mockResolvedValue(null);
  tx.user.update.mockImplementation(async ({ data }) => ({ ...TARGET, ...data }));
});

describe('parseListParams', () => {
  it('applies defaults and clamps', () => {
    expect(parseListParams({})).toEqual({ page: 1, pageSize: 12, query: '' });
    expect(parseListParams({ page: '0', pageSize: '500', query: '  bob ' }))
      .toEqual({ page: 1, pageSize: 100, query: 'bob' });
    expect(parseListParams({ page: '3', pageSize: '24' })).toMatchObject({ page: 3, pageSize: 24 });
    expect(parseListParams({ page: 'x', pageSize: '-5' })).toMatchObject({ page: 1, pageSize: 12 });
  });
});

describe('validateUserUpdate', () => {
  it.each([[undefined], [null], [{}], [[]], [{ role: 'admin' }], [{ email: 'a@b.co', role: 'admin' }], [{ enabled: 'no' }]])(
    'rejects %j with INVALID_FIELDS',
    (body) => expect(validateUserUpdate(body)).toEqual({ errorCode: 'INVALID_FIELDS' }),
  );

  it.each([[{ email: '' }], [{ email: null }], [{ email: 'no-at' }], [{ email: 'a b@c.de' }], [{ email: `${'a'.repeat(250)}@x.org` }]])(
    'rejects %j with INVALID_EMAIL',
    (body) => expect(validateUserUpdate(body)).toEqual({ errorCode: 'INVALID_EMAIL' }),
  );

  it('accepts and trims email and enabled', () => {
    expect(validateUserUpdate({ email: ' New@Example.com ', enabled: false }).data)
      .toEqual({ email: 'New@Example.com', enabled: false });
  });
});

describe('updateUser', () => {
  it('throws USER_NOT_FOUND', async () => {
    tx.user.findUnique.mockResolvedValue(null);
    await expect(updateUser(ACTOR, 'x', { enabled: true })).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });

  it('disables a user, sets the session cutoff, audits and returns the public shape', async () => {
    const user = await updateUser(ACTOR, 'alice', { enabled: false }, { ip: '1.1.1.1' });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 3},
      data: { isActive: false, sessionsValidAfter: expect.any(Date) },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      tx, expect.objectContaining({ action: 'user.disable', targetId: 3, metadata: {}, ip: '1.1.1.1' }),
    );
    expect(user).toEqual({ id: 3, username: 'alice', fullName: 'Alice', email: 'a@x.org', role: 'reader', enabled: false, lastLoginAt: null });
    expect(user).not.toHaveProperty('password');
  });

  it('is a successful no-op when enabled already has that value', async () => {
    await updateUser(ACTOR, 'alice', { enabled: true });
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it('re-enabling audits user.enable', async () => {
    tx.user.findUnique.mockResolvedValue({ ...TARGET, isActive: false });
    await updateUser(ACTOR, 'alice', { enabled: true });
    expect(recordAudit).toHaveBeenCalledWith(tx, expect.objectContaining({ action: 'user.enable' }));
  });

  it('refuses to let an admin disable themself', async () => {
    tx.user.findUnique.mockResolvedValue({ ...TARGET, id: 1, role: 'admin' });
    await expect(updateUser(ACTOR, 'boss', { enabled: false })).rejects.toMatchObject({ code: 'CANNOT_MODIFY_SELF' });
  });

  it('refuses to disable the last enabled admin', async () => {
    tx.user.findUnique.mockResolvedValue({ ...TARGET, id: 9, role: 'admin' });
    tx.$queryRaw.mockResolvedValue([{ id: 9 }]);
    await expect(updateUser(ACTOR, 'adm', { enabled: false })).rejects.toMatchObject({ code: 'LAST_ADMIN' });
  });

  it('allows disabling an admin when another enabled admin exists', async () => {
    tx.user.findUnique.mockResolvedValue({ ...TARGET, id: 9, role: 'admin' });
    tx.$queryRaw.mockResolvedValue([{ id: 9 }, { id: 1 }]);
    await expect(updateUser(ACTOR, 'adm', { enabled: false })).resolves.toMatchObject({ enabled: false });
  });

  it('updates email and audits from/to', async () => {
    await updateUser(ACTOR, 'alice', { email: 'new@x.org' });
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { email: 'new@x.org' } });
    expect(recordAudit).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: 'user.email.update', metadata: { from: 'a@x.org', to: 'new@x.org' } }),
    );
  });

  it('throws DUPLICATE_EMAIL when another user has the email (case-insensitive lookup)', async () => {
    tx.user.findFirst.mockResolvedValue({ id: 8 });
    await expect(updateUser(ACTOR, 'alice', { email: 'dup@x.org' })).rejects.toMatchObject({ code: 'DUPLICATE_EMAIL' });
    expect(tx.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: { equals: 'dup@x.org', mode: 'insensitive' }, NOT: { id: 3 } } }),
    );
  });

  it('maps a unique-index violation to DUPLICATE_EMAIL', async () => {
    tx.user.update.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
    await expect(updateUser(ACTOR, 'alice', { email: 'race@x.org' })).rejects.toMatchObject({ code: 'DUPLICATE_EMAIL' });
  });
});

describe('deleteUser', () => {
  it('throws USER_NOT_FOUND', async () => {
    tx.user.findUnique.mockResolvedValue(null);
    await expect(deleteUser(ACTOR, 'x')).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
  });

  it('refuses self-delete and the last admin', async () => {
    tx.user.findUnique.mockResolvedValue({ ...TARGET, id: 1 });
    await expect(deleteUser(ACTOR, 'boss')).rejects.toMatchObject({ code: 'CANNOT_MODIFY_SELF' });

    tx.user.findUnique.mockResolvedValue({ ...TARGET, id: 9, role: 'admin' });
    tx.$queryRaw.mockResolvedValue([{ id: 9 }]);
    await expect(deleteUser(ACTOR, 'adm')).rejects.toMatchObject({ code: 'LAST_ADMIN' });
    expect(tx.user.delete).not.toHaveBeenCalled();
  });

  it('deletes the user and keeps the username in the audit entry', async () => {
    await deleteUser(ACTOR, 'alice');
    expect(tx.user.delete).toHaveBeenCalledWith({ where: { id: 3 } });
    expect(recordAudit).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: 'user.delete', targetId: 3, metadata: { username: 'alice' } }),
    );
  });
});
