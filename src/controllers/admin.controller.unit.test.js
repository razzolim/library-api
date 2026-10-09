import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/users.service.js', () => ({ resetPasswordAsAdmin: vi.fn() }));

import * as usersService from '../services/users.service.js';
import { resetUserPassword } from './admin.controller.js';

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
    params: { username: 'reader' },
    user: ACTOR,
    ip: '1.1.1.1',
    get: vi.fn().mockReturnValue('agent'),
  };
}

beforeEach(() => vi.clearAllMocks());

describe('resetUserPassword controller', () => {
  it('returns 200 with the username and never the password', async () => {
    usersService.resetPasswordAsAdmin.mockResolvedValue({ username: 'reader' });
    const res = mockRes();
    await resetUserPassword(mockReq(), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, username: 'reader' });
    expect(usersService.resetPasswordAsAdmin).toHaveBeenCalledWith(
      ACTOR, 'reader', 'long-enough', { ip: '1.1.1.1', userAgent: 'agent' },
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
