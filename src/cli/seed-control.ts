/**
 * Seeds the control plane. Idempotent; safe on every deploy:
 *  - plans (limits are updated),
 *  - default Super Admin superadmin@platform.local (created only if missing),
 *  - on a brand-new platform (no tenant at all): the default tenant "dfm" with its 5 default accounts.
 * Usage: npm run db:control:seed   (container: node dist/cli/seed-control.js)
 */
import { Logger } from '@nestjs/common';
import { ControlPrismaService } from '../database/control-prisma.service';
import {
  DEFAULT_PASSWORD,
  DEFAULT_TENANT,
  defaultTenantAccounts,
  ensureDefaultSuperAdmin,
} from '../modules/platform/tenants/default-accounts';
import { TenantsService } from '../modules/platform/tenants/tenants.service';
import { runCli, withAppContext } from './cli-context';

// Seed accounts count against the limits: starter leaves room for the requested admin + 5 defaults + 4 users.
export const PLANS = [
  { code: 'starter', name: 'Starter', maxUsers: 10, maxCompanies: 1, maxInvoicesMonthly: 200, maxAiCallsMonthly: 500 },
  { code: 'business', name: 'Business', maxUsers: 50, maxCompanies: 10, maxInvoicesMonthly: 5000, maxAiCallsMonthly: 10000 },
];

export interface SeedControlResult {
  superAdminCreated: boolean;
  defaultTenantCreated: boolean;
}

export function seedControl(): Promise<SeedControlResult> {
  return withAppContext(async (app) => {
    const logger = new Logger('SeedControl');
    const control = app.get(ControlPrismaService);

    for (const plan of PLANS) await control.plan.upsert({ where: { code: plan.code }, create: plan, update: plan });

    const superAdminCreated = await ensureDefaultSuperAdmin(control);
    if (superAdminCreated) logger.warn('Created default Super Admin superadmin@platform.local (default password)');

    let defaultTenantCreated = false;
    if ((await control.tenant.count()) === 0) {
      const [admin] = defaultTenantAccounts(DEFAULT_TENANT.subdomain);
      await app.get(TenantsService).create({
        ...DEFAULT_TENANT,
        adminEmail: admin.email,
        adminFullName: admin.fullName,
        adminPassword: DEFAULT_PASSWORD,
      });
      defaultTenantCreated = true;
      logger.warn(`Created default tenant "${DEFAULT_TENANT.subdomain}" with its default accounts (default password)`);
    }
    return { superAdminCreated, defaultTenantCreated };
  });
}

if (require.main === module) runCli(seedControl);
