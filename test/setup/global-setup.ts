import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import './env';
import { purgeE2eTenants } from '../support/db';

const ROOT = join(__dirname, '..', '..');

/** Control DB migrated + seeded (plans, platform admin); leftovers of previous runs removed. */
export default async function globalSetup() {
  const prisma = require.resolve('prisma/build/index.js');
  execFileSync(process.execPath, [prisma, 'migrate', 'deploy', '--config', 'prisma.control.config.ts'], { cwd: ROOT, stdio: 'pipe' });
  execFileSync(process.execPath, [require.resolve('tsx/cli'), 'scripts/seed-control.ts'], { cwd: ROOT, stdio: 'pipe', env: process.env });
  await purgeE2eTenants();
}
