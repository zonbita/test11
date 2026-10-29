import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { decryptSecret } from '../../common/crypto/secret-box';
import { ControlEventsService } from '../../database/control-events.service';
import { ControlPrismaService } from '../../database/control-prisma.service';
import { TenantPrismaClient, TenantPrismaManager } from '../../database/tenant-prisma.manager';
import { Tenant } from '../../generated/control/client';

const CACHE_TTL_MS = 60_000;

type TenantConnection = Pick<Tenant, 'dbHost' | 'dbPort' | 'dbName' | 'dbUser' | 'dbPasswordEnc'>;

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
    const password = decryptSecret(tenant.dbPasswordEnc, this.config.getOrThrow('DB_CREDENTIALS_KEY'));
    return `postgresql://${encodeURIComponent(tenant.dbUser)}:${encodeURIComponent(password)}@${tenant.dbHost}:${tenant.dbPort}/${tenant.dbName}`;
  }
}
