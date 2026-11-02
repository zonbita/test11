import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { decryptSecret } from '../../common/crypto/secret-box';
import { ControlEventsService } from '../../database/control-events.service';
import { ControlPrismaService } from '../../database/control-prisma.service';
import { TenantPrismaClient, TenantPrismaManager } from '../../database/tenant-prisma.manager';
import { Tenant } from '../../generated/control/client';

const CACHE_TTL_MS = 60_000;

/** The only cluster today; its address is TENANT_DB_HOST / TENANT_DB_PORT of the running process. */
export const DEFAULT_DB_CLUSTER = 'default';

type TenantConnection = Pick<Tenant, 'dbCluster' | 'dbName' | 'dbUser' | 'dbPasswordEnc'>;

/** Looks up tenants in the control plane and hands out the matching tenant DB client. */
@Injectable()
export class TenantRegistryService {
  private readonly cache = new Map<string, { tenant: Tenant | null; expiresAt: number }>();

  constructor(
    private readonly control: ControlPrismaService,
    private readonly manager: TenantPrismaManager,
    private readonly config: ConfigService,
    events: ControlEventsService,
  ) {
    events.subscribe((event) => {
      if (event.kind !== 'tenant') return;
      this.cache.delete(event.subdomain);
      void this.manager.evict(event.tenantId);
    });
  }

  /** Any status; the caller decides what a non-ACTIVE tenant means. */
  async findBySubdomain(subdomain: string): Promise<Tenant | null> {
    const cached = this.cache.get(subdomain);
    if (cached && cached.expiresAt > Date.now()) return cached.tenant;
    const tenant = await this.control.tenant.findUnique({ where: { subdomain } });
    this.cache.set(subdomain, { tenant, expiresAt: Date.now() + CACHE_TTL_MS });
    return tenant;
  }

  clientFor(tenant: Pick<Tenant, 'id'> & TenantConnection): TenantPrismaClient {
    return this.manager.get(tenant.id, this.connectionString(tenant));
  }

  connectionString(tenant: TenantConnection): string {
    const { host, port } = this.clusterAddress(tenant.dbCluster);
    const password = decryptSecret(tenant.dbPasswordEnc, this.config.getOrThrow('DB_CREDENTIALS_KEY'));
    return `postgresql://${encodeURIComponent(tenant.dbUser)}:${encodeURIComponent(password)}@${host}:${port}/${tenant.dbName}`;
  }

  /** Never falls back to another cluster: connecting a tenant to the wrong server must fail loudly. */
  private clusterAddress(cluster: string): { host: string; port: number } {
    if (cluster !== DEFAULT_DB_CLUSTER) throw new Error(`Unknown database cluster "${cluster}"`);
    return { host: this.config.getOrThrow<string>('TENANT_DB_HOST'), port: this.config.getOrThrow<number>('TENANT_DB_PORT') };
  }
}
