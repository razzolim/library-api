import { prisma } from '../lib/prisma.js';

export function listChangelog() {
  return prisma.changelogEntry.findMany({ orderBy: { date: 'desc' } });
}
