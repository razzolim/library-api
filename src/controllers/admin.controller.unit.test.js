import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/users.service.js', () => ({ resetPasswordAsAdmin: vi.fn() }));
vi.mock('../services/adminUsers.service.js', () => ({
  listUsers: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
  validateUserUpdate: vi.fn(),
}));

import * as usersService from '../services/users.service.js';
import * as adminUsersService from '../services/adminUsers.service.js';
import { deleteUser, listUsers, resetUserPassword, updateUser } from './admin.controller.js';

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

const ACTOR = { sub: 2, username: 'boss' };

function mockReq(body = { newPassword: 'long-enough' }) {
  return {
    body,
    params: { username: 'demo.user' },
    user: ACTOR,
    ip: '1.1.1.1',
    get: vi.fn().mockReturnValue('agent'),
  };
}

beforeEach(() => vi.clearAllMocks());

describe('resetUserPassword controller', () => {
  it('returns 200 with the username and never the password', async () => {
    usersService.resetPasswordAsAdmin.mockResolvedValue({ username: 'demo.user' });
    const res = mockRes();
    await resetUserPassword(mockReq(), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, username: 'demo.user' });
    expect(usersService.resetPasswordAsAdmin).toHaveBeenCalledWith(
      ACTOR, 'demo.user', 'long-enough', { ip: '1.1.1.1', userAgent: 'agent' },
    );
  });

  it.each([[{}], [{ newPassword: 'short' }], [{ newPassword: 12345678 }], [undefined]])(
    'returns 400 weakPassword for body %j',
    async (body) => {
      const res = mockRes();
      await resetUserPassword({ ...mockReq(), body }, res, vi.fn());
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ success: false, errorKey: 'admin.resetPassword.weakPassword' });
      expect(usersService.resetPasswordAsAdmin).not.toHaveBeenCalled();
    },
  );

  it('returns 404 when the user does not exist', async () => {
    usersService.resetPasswordAsAdmin.mockRejectedValue(Object.assign(new Error(), { code: 'USER_NOT_FOUND' }));
    const res = mockRes();
    await resetUserPassword(mockReq(), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, errorKey: 'admin.resetPassword.userNotFound' });
  });

  it('returns 400 useAccountPage when the admin targets themself', async () => {
    usersService.resetPasswordAsAdmin.mockRejectedValue(Object.assign(new Error(), { code: 'USE_ACCOUNT_PAGE' }));
    const res = mockRes();
    await resetUserPassword(mockReq(), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ success: false, errorKey: 'admin.resetPassword.useAccountPage' });
  });

  it('calls next for unexpected errors', async () => {
    usersService.resetPasswordAsAdmin.mockRejectedValue(new Error('db'));
    const next = vi.fn();
    await resetUserPassword(mockReq(), mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

describe('admin users controllers', () => {
  it.each([
    ['USER_NOT_FOUND', 404, 'admin.users.notFound'],
    ['DUPLICATE_EMAIL', 409, 'admin.users.duplicateEmail'],
    ['CANNOT_MODIFY_SELF', 409, 'admin.users.cannotModifySelf'],
    ['LAST_ADMIN', 409, 'admin.users.lastAdmin'],
  ])('deleteUser maps %s to %i %s', async (code, status, errorKey) => {
    adminUsersService.deleteUser.mockRejectedValue(Object.assign(new Error(), { code }));
    const res = mockRes();
    await deleteUser(mockReq(), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(status);
    expect(res.json).toHaveBeenCalledWith({ success: false, errorKey });
  });

  it('updateUser returns 400 invalidEmail / invalidFields from validation without calling the service', async () => {
    adminUsersService.validateUserUpdate.mockReturnValue({ errorCode: 'INVALID_EMAIL' });
    const res = mockRes();
    await updateUser(mockReq({}), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ success: false, errorKey: 'admin.users.invalidEmail' });
    expect(adminUsersService.updateUser).not.toHaveBeenCalled();
  });

  it('updateUser returns { success, user }', async () => {
    adminUsersService.validateUserUpdate.mockReturnValue({ data: { enabled: false } });
    adminUsersService.updateUser.mockResolvedValue({ id: 3 });
    const res = mockRes();
    await updateUser(mockReq({ enabled: false }), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, user: { id: 3 } });
  });

  it('listUsers returns the service result; deleteUser returns { success: true }', async () => {
    adminUsersService.listUsers.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 12 });
    const res = mockRes();
    await listUsers({ query: {} }, res, vi.fn());
    expect(res.json).toHaveBeenCalledWith({ items: [], total: 0, page: 1, pageSize: 12 });

    adminUsersService.deleteUser.mockResolvedValue();
    const res2 = mockRes();
    await deleteUser(mockReq(), res2, vi.fn());
    expect(res2.json).toHaveBeenCalledWith({ success: true });
  });

  it('passes unknown errors to next', async () => {
    adminUsersService.deleteUser.mockRejectedValue(new Error('db'));
    const next = vi.fn();
    await deleteUser(mockReq(), mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});
