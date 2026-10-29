/**
 * Applies pending tenant-schema migrations to every tenant database, one after another (F01 AC-06):
 * a failing tenant does not stop the others. Then, per tenant: re-syncs the RBAC catalog, adds missing
 * default accounts, records the schema version and tells running API instances to reload the policy.
 * Usage: npm run db:tenants:deploy [-- --tenant=<subdomain>]   (container: node dist/cli/migrate-tenants.js)
 */
import { Logger } from '@nestjs/common';
import { ControlEventsService } from '../database/control-events.service';
import { ControlPrismaService } from '../database/control-prisma.service';
import { TenantStatus } from '../generated/control/enums';
import { ensureDefaultTenantAccounts } from '../modules/platform/tenants/default-accounts';
import { migrateTenantDatabase } from '../modules/platform/tenants/tenant-migrator';
import { syncRbacCatalog } from '../modules/rbac/role-grants';
import { TenantRegistryService } from '../modules/tenancy/tenant-registry.service';
import { runCli, withAppContext } from './cli-context';

export interface MigrateTenantsResult {
  migrated: string[];
  failed: string[];
}

export function migrateTenants(only?: string): Promise<MigrateTenantsResult> {
  return withAppContext(async (app) => {
    const logger = new Logger('MigrateTenants');
    const control = app.get(ControlPrismaService);
    const registry = app.get(TenantRegistryService);
    const events = app.get(ControlEventsService);

    const tenants = await control.tenant.findMany({
      where: { status: { in: [TenantStatus.ACTIVE, TenantStatus.SUSPENDED] }, ...(only && { subdomain: only }) },
      orderBy: { createdAt: 'asc' },
    });

    const result: MigrateTenantsResult = { migrated: [], failed: [] };
    for (const t of tenants) {
      try {
        const schemaVersion = await migrateTenantDatabase(registry.connectionString(t));
        const db = registry.clientFor(t);
        await db.$transaction((tx) => syncRbacCatalog(tx));
        const created = await ensureDefaultTenantAccounts(db, t.subdomain);
        await control.tenant.update({ where: { id: t.id }, data: { schemaVersion } });
        await events.publish({ kind: 'policy', tenantId: t.id });
        result.migrated.push(t.subdomain);
        logger.log({ tenant: t.subdomain, schemaVersion, createdAccounts: created }, 'Tenant migrated');
      } catch (error) {
        result.failed.push(t.subdomain);
        logger.error({ err: error, tenant: t.subdomain }, 'Tenant migration failed');
      }
    }
    logger.log(`${result.migrated.length}/${tenants.length} tenants migrated`);
    return result;
  });
}

if (require.main === module) {
  const only = process.argv.find((a) => a.startsWith('--tenant='))?.split('=')[1];
  runCli(async () => {
    const { failed } = await migrateTenants(only);
    if (failed.length > 0) throw new Error(`Migration failed for: ${failed.join(', ')}`);
  });
}
