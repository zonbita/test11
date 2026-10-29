/**
 * Seeds the control plane: default plans + the first super admin (from PLATFORM_ADMIN_* env).
 * Usage: npm run db:control:seed
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/control/client';
import { hashPassword } from '../src/modules/auth/password';

const PLANS = [
  { code: 'starter', name: 'Starter', maxUsers: 5, maxCompanies: 1, maxInvoicesMonthly: 200, maxAiCallsMonthly: 500 },
  { code: 'business', name: 'Business', maxUsers: 50, maxCompanies: 10, maxInvoicesMonthly: 5000, maxAiCallsMonthly: 10000 },
];

async function main() {
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.CONTROL_DATABASE_URL! }) });
  try {
    for (const plan of PLANS) {
      await db.plan.upsert({ where: { code: plan.code }, create: plan, update: plan });
    }

    const email = process.env.PLATFORM_ADMIN_EMAIL?.toLowerCase();
    const password = process.env.PLATFORM_ADMIN_PASSWORD;
    if (email && password) {
      await db.platformAdmin.upsert({
        where: { email },
        create: { email, passwordHash: await hashPassword(password), fullName: 'Super Admin' },
        update: {},
      });
      console.log(`Platform admin ready: ${email}`);
    }
    console.log(`Plans: ${PLANS.map((p) => p.code).join(', ')}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
