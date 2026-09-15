import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    changelogEntry: { findMany: vi.fn() },
  },
}));

import { prisma } from '../lib/prisma.js';
import { listChangelog } from './changelog.service.js';

beforeEach(() => vi.clearAllMocks());

describe('listChangelog', () => {
  it('queries entries ordered by date descending', async () => {
    prisma.changelogEntry.findMany.mockResolvedValue([]);
    await listChangelog();
    expect(prisma.changelogEntry.findMany).toHaveBeenCalledWith({ orderBy: { date: 'desc' } });
  });

  it('returns whatever the database returns', async () => {
    const rows = [{ id: 1, version: '1.0.0' }];
    prisma.changelogEntry.findMany.mockResolvedValue(rows);
    expect(await listChangelog()).toBe(rows);
  });
});
