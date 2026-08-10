import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export default async function setup() {
  const dbPath = fileURLToPath(new URL('../prisma/test.db', import.meta.url));

  if (existsSync(dbPath)) {
    rmSync(dbPath);
  }

  execSync('npx prisma db push --skip-generate', {
    stdio: 'inherit',
    env: process.env,
  });
}
