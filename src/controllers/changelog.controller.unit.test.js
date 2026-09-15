import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/changelog.service.js', () => ({
  listChangelog: vi.fn(),
}));

import * as changelogService from '../services/changelog.service.js';
import { listChangelog } from './changelog.controller.js';

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => vi.clearAllMocks());

describe('listChangelog controller', () => {
  it('returns 200 with the entries array from the service', async () => {
    const entries = [{ id: 1, version: '1.0.0' }];
    changelogService.listChangelog.mockResolvedValue(entries);
    const res = mockRes();
    await listChangelog({}, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(entries);
  });

  it('calls next with the error when the service throws', async () => {
    changelogService.listChangelog.mockRejectedValue(new Error('db'));
    const next = vi.fn();
    await listChangelog({}, mockRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});
