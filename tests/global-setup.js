import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export default async function setup() {
  if (process.env.SKIP_DB_MIGRATE === 'true') return;

  const script = fileURLToPath(new URL('../scripts/migrate-test-db.sh', import.meta.url));

  execSync(script, {
    stdio: 'inherit',
    env: process.env,
  });
}
