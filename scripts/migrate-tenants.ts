/**
 * Applies pending tenant-schema migrations to every tenant database, one after another (F01 AC-06):
 * a failing tenant does not stop the others. Then re-syncs the RBAC catalog and records the schema version.
 * Usage: npm run db:tenants:deploy [-- --tenant=<subdomain>]
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { decryptSecret } from '../src/common/crypto/secret-box';
import { PrismaClient, TenantStatus } from '../src/generated/control/client';
import { PrismaClient as TenantPrismaClient } from '../src/generated/tenant/client';
import { migrateTenantDatabase } from '../src/modules/platform/tenants/tenant-migrator';
import { syncRbacCatalog } from '../src/modules/rbac/role-grants';

async function main() {
  const only = process.argv.find((a) => a.startsWith('--tenant='))?.split('=')[1];
  const control = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.CONTROL_DATABASE_URL! }) });
  const tenants = await control.tenant.findMany({
    where: { status: { in: [TenantStatus.ACTIVE, TenantStatus.SUSPENDED] }, ...(only && { subdomain: only }) },
    orderBy: { createdAt: 'asc' },
  });

  const failed: string[] = [];
  for (const t of tenants) {
    const password = decryptSecret(t.dbPasswordEnc, process.env.DB_CREDENTIALS_KEY!);
    const url = `postgresql://${encodeURIComponent(t.dbUser)}:${encodeURIComponent(password)}@${t.dbHost}:${t.dbPort}/${t.dbName}`;
    try {
      const schemaVersion = await migrateTenantDatabase(url);
      const db = new TenantPrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
      try {
        await db.$transaction((tx) => syncRbacCatalog(tx));
      } finally {
        await db.$disconnect();
      }
      await control.tenant.update({ where: { id: t.id }, data: { schemaVersion } });
      // Running API instances reload this tenant's policy
      await control.$executeRaw`SELECT pg_notify('compte_authz', ${JSON.stringify({ kind: 'policy', tenantId: t.id })})`;
      console.log(`✔ ${t.subdomain} -> ${schemaVersion}`);
    } catch (error) {
      failed.push(t.subdomain);
      console.error(`✘ ${t.subdomain}: ${(error as Error).message}`);
    }
  }
  await control.$disconnect();

  console.log(`${tenants.length - failed.length}/${tenants.length} tenants migrated`);
  if (failed.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
