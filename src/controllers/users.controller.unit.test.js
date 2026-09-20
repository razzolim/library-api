import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/users.service.js', () => ({
  changePassword: vi.fn(),
  createUser: vi.fn(),
  deactivateUser: vi.fn(),
}));

import * as usersService from '../services/users.service.js';
import { changePassword, createUser, deactivateUser } from './users.controller.js';

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

describe('createUser controller', () => {
  const validBody = { username: 'bob', password: 'pass', fullName: 'Bob' };
  const adminReq = (body) => ({ body, user: { sub: 1, role: 'admin' } });

  it('returns 400 when username is missing', async () => {
    const res = mockRes();
    await createUser(adminReq({ password: 'pass', fullName: 'Bob' }), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, errorKey: 'users.createUser.missingFields' }),
    );
  });

  it('returns 400 when password is missing', async () => {
    const res = mockRes();
    await createUser(adminReq({ username: 'bob', fullName: 'Bob' }), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 400 when fullName is missing', async () => {
    const res = mockRes();
    await createUser(adminReq({ username: 'bob', password: 'pass' }), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('returns 409 when service throws USERNAME_TAKEN', async () => {
    const err = new Error('taken');
    err.code = 'USERNAME_TAKEN';
    usersService.createUser.mockRejectedValue(err);
    const res = mockRes();
    await createUser(adminReq(validBody), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, errorKey: 'users.createUser.usernameTaken' }),
    );
  });

  it('returns 201 with user profile on success', async () => {
    const user = { id: 2, username: 'bob', fullName: 'Bob', role: 'reader' };
    usersService.createUser.mockResolvedValue(user);
    const res = mockRes();
    await createUser(adminReq(validBody), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ success: true, user });
  });

  it('calls next with error on unexpected service failure', async () => {
    const err = new Error('db error');
    usersService.createUser.mockRejectedValue(err);
    const next = vi.fn();
    await createUser(adminReq(validBody), mockRes(), next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

describe('deactivateUser controller', () => {
  const adminReq = (id) => ({ params: { id: String(id) }, user: { sub: 1, role: 'admin' } });

  it('returns 404 when id is not a number', async () => {
    const res = mockRes();
    await deactivateUser({ params: { id: 'abc' }, user: { sub: 1 } }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 404 when service throws USER_NOT_FOUND', async () => {
    const err = new Error('not found');
    err.code = 'USER_NOT_FOUND';
    usersService.deactivateUser.mockRejectedValue(err);
    const res = mockRes();
    await deactivateUser(adminReq(99), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ errorKey: 'users.deactivateUser.notFound' }),
    );
  });

  it('returns 403 when service throws CANNOT_DEACTIVATE_ADMIN', async () => {
    const err = new Error('admin');
    err.code = 'CANNOT_DEACTIVATE_ADMIN';
    usersService.deactivateUser.mockRejectedValue(err);
    const res = mockRes();
    await deactivateUser(adminReq(2), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ errorKey: 'users.deactivateUser.cannotDeactivateAdmin' }),
    );
  });

  it('returns 200 on success', async () => {
    usersService.deactivateUser.mockResolvedValue();
    const res = mockRes();
    await deactivateUser(adminReq(2), res, vi.fn());
    expect(usersService.deactivateUser).toHaveBeenCalledWith(2);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('calls next with error on unexpected failure', async () => {
    const err = new Error('db error');
    usersService.deactivateUser.mockRejectedValue(err);
    const next = vi.fn();
    await deactivateUser(adminReq(2), mockRes(), next);
    expect(next).toHaveBeenCalledWith(err);
  });
});

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
