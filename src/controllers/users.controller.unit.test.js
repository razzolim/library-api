import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/users.service.js', () => ({
  changePassword: vi.fn(),
}));

import * as usersService from '../services/users.service.js';
import { changePassword } from './users.controller.js';

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

function wrongPasswordError() {
  const err = new Error('Current password is incorrect');
  err.code = 'WRONG_PASSWORD';
  return err;
}

beforeEach(() => vi.clearAllMocks());

describe('changePassword controller', () => {
  it('returns 400 when currentPassword is missing', async () => {
    const res = mockRes();
    await changePassword({ body: { newPassword: 'new' }, user: { sub: 1 } }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, errorKey: 'users.changePassword.missingFields' }),
    );
    expect(usersService.changePassword).not.toHaveBeenCalled();
  });

  it('returns 400 when newPassword is missing', async () => {
    const res = mockRes();
    await changePassword({ body: { currentPassword: 'old' }, user: { sub: 1 } }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(usersService.changePassword).not.toHaveBeenCalled();
  });

  it('returns 400 when body is absent', async () => {
    const res = mockRes();
    await changePassword({ body: undefined, user: { sub: 1 } }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 401 with wrongCurrentPassword errorKey when service throws WRONG_PASSWORD', async () => {
    usersService.changePassword.mockRejectedValue(wrongPasswordError());
    const res = mockRes();
    await changePassword(
      { body: { currentPassword: 'wrong', newPassword: 'new' }, user: { sub: 1 } },
      res,
      vi.fn(),
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, errorKey: 'users.changePassword.wrongCurrentPassword' }),
    );
  });

  it('returns 200 on success', async () => {
    usersService.changePassword.mockResolvedValue();
    const res = mockRes();
    await changePassword(
      { body: { currentPassword: 'old', newPassword: 'new' }, user: { sub: 1 } },
      res,
      vi.fn(),
    );
    expect(usersService.changePassword).toHaveBeenCalledWith(1, 'old', 'new');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('calls next with the error when the service throws an unexpected error', async () => {
    const err = new Error('db error');
    usersService.changePassword.mockRejectedValue(err);
    const next = vi.fn();
    await changePassword(
      { body: { currentPassword: 'old', newPassword: 'new' }, user: { sub: 1 } },
      mockRes(),
      next,
    );
    expect(next).toHaveBeenCalledWith(err);
  });
});
