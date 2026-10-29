import { HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { encryptSecret } from '../../../common/crypto/secret-box';
import { AppException, fieldError } from '../../../common/errors/app.exception';
import { ErrorCode } from '../../../common/errors/error-codes';
import { ControlEventsService } from '../../../database/control-events.service';
import { ControlPrismaService } from '../../../database/control-prisma.service';
import { TenantPrismaManager } from '../../../database/tenant-prisma.manager';
import { Prisma, Tenant, TenantStatus } from '../../../generated/control/client';
import { hashPassword } from '../../auth/password';
import { TenantRegistryService } from '../../tenancy/tenant-registry.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantStatusDto } from './dto/update-tenant-status.dto';
import { migrateTenantDatabase } from './tenant-migrator';
import { TenantProvisionerService } from './tenant-provisioner.service';
import { seedTenant } from './tenant-seeder';
import { assertTransition } from './tenant-status';

const RESERVED_SUBDOMAINS = ['www', 'api', 'app', 'admin', 'platform', 'mail', 'static', 'cdn', 'docs', 'health'];
const DEFAULT_PLAN = 'starter';

// Never return DB credentials or provisioning input to the client
const PUBLIC_FIELDS = {
  id: true,
  name: true,
  subdomain: true,
  status: true,
  schemaVersion: true,
  failureReason: true,
  plan: { select: { id: true, code: true, name: true } },
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TenantSelect;

/** Non-secret data needed to (re)run provisioning */
interface ProvisioningInput {
  companyLegalName: string;
  companyCountryCode?: string;
  companyCurrency?: string;
  adminEmail: string;
  adminFullName: string;
}

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);

  constructor(
    private readonly control: ControlPrismaService,
    private readonly provisioner: TenantProvisionerService,
    private readonly registry: TenantRegistryService,
    private readonly manager: TenantPrismaManager,
    private readonly events: ControlEventsService,
    private readonly config: ConfigService,
  ) {}

  list() {
    return this.control.tenant.findMany({ select: PUBLIC_FIELDS, orderBy: { createdAt: 'desc' } });
  }

  async get(id: string) {
    const tenant = await this.control.tenant.findUnique({ where: { id }, select: PUBLIC_FIELDS });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async create(dto: CreateTenantDto) {
    // F01 AC-02: invalid/duplicate subdomain -> 422, no database created
    if (RESERVED_SUBDOMAINS.includes(dto.subdomain)) {
      throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.SUBDOMAIN_RESERVED, 'Subdomain is reserved', [
        { field: 'subdomain', code: ErrorCode.SUBDOMAIN_RESERVED, message: 'Subdomain is reserved' },
      ]);
    }
    if (await this.control.tenant.findUnique({ where: { subdomain: dto.subdomain } })) {
      throw new AppException(HttpStatus.UNPROCESSABLE_ENTITY, ErrorCode.SUBDOMAIN_TAKEN, 'Subdomain already taken', [
        { field: 'subdomain', code: ErrorCode.SUBDOMAIN_TAKEN, message: 'Subdomain already taken' },
      ]);
    }
    const plan = await this.control.plan.findUnique({ where: { code: dto.planCode ?? DEFAULT_PLAN } });
    if (!plan) throw fieldError('planCode', 'unknownPlan', 'Unknown plan');

    const input: ProvisioningInput = {
      companyLegalName: dto.companyLegalName,
      companyCountryCode: dto.companyCountryCode,
      companyCurrency: dto.companyCurrency,
      adminEmail: dto.adminEmail.toLowerCase(),
      adminFullName: dto.adminFullName,
    };
    const creds = this.provisioner.credentialsFor(dto.subdomain);
    const tenant = await this.control.tenant.create({
      data: {
        name: dto.name,
        subdomain: dto.subdomain,
        planId: plan.id,
        status: TenantStatus.PROVISIONING,
        dbHost: this.config.getOrThrow('TENANT_DB_HOST'),
        dbPort: this.config.getOrThrow<number>('TENANT_DB_PORT'),
        dbName: creds.dbName,
        dbUser: creds.dbUser,
        dbPasswordEnc: this.encrypt(creds.password),
        provisioningInput: input as unknown as Prisma.InputJsonValue,
      },
    });
    return this.provision(tenant, creds.password, input, dto.adminPassword);
  }

  /** F01 AC-03: a FAILED tenant can be provisioned again. */
  async retry(id: string, adminPassword: string) {
    const tenant = await this.control.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    assertTransition(tenant.status, TenantStatus.PROVISIONING);

    const password = this.provisioner.credentialsFor(tenant.subdomain).password;
    const updated = await this.control.tenant.update({
      where: { id },
      data: { status: TenantStatus.PROVISIONING, failureReason: null, dbPasswordEnc: this.encrypt(password) },
    });
    return this.provision(updated, password, tenant.provisioningInput as unknown as ProvisioningInput, adminPassword);
  }

  async setStatus(id: string, dto: UpdateTenantStatusDto) {
    const tenant = await this.control.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    assertTransition(tenant.status, dto.status);

    const now = new Date();
    const updated = await this.control.tenant.update({
      where: { id },
      data: {
        status: dto.status,
        suspendedAt: dto.status === TenantStatus.SUSPENDED ? now : dto.status === TenantStatus.ACTIVE ? null : undefined,
        // F01 BR-06: access is blocked now; the purge job drops DB and files after 30 days (not implemented yet)
        deletedAt: dto.status === TenantStatus.DELETED ? now : undefined,
      },
      select: PUBLIC_FIELDS,
    });
    this.logger.log({ tenantId: id, from: tenant.status, to: dto.status, reason: dto.reason }, 'Tenant status changed');
    // Drops the cached tenant lookup and connection pool on every instance
    await this.events.publish({ kind: 'tenant', tenantId: id, subdomain: tenant.subdomain });
    return updated;
  }

  private async provision(tenant: Tenant, dbPassword: string, input: ProvisioningInput, adminPassword: string) {
    let step = 'create database';
    try {
      await this.provisioner.createDatabase({ dbName: tenant.dbName, dbUser: tenant.dbUser, password: dbPassword });
      step = 'migrate';
      const schemaVersion = await migrateTenantDatabase(this.registry.connectionString(tenant));
      step = 'seed';
      await seedTenant(this.registry.clientFor(tenant), {
        company: { legalName: input.companyLegalName, countryCode: input.companyCountryCode, currency: input.companyCurrency },
        admin: { email: input.adminEmail, fullName: input.adminFullName, passwordHash: await hashPassword(adminPassword) },
      });
      step = 'activate';
      return await this.control.tenant.update({
        where: { id: tenant.id },
        data: { status: TenantStatus.ACTIVE, schemaVersion, provisioningInput: Prisma.DbNull, failureReason: null },
        select: PUBLIC_FIELDS,
      });
    } catch (error) {
      this.logger.error({ err: error, tenantId: tenant.id, step }, 'Tenant provisioning failed');
      await this.cleanup(tenant, `${step}: ${(error as Error).message}`.slice(0, 500));
      throw new AppException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        ErrorCode.PROVISIONING_FAILED,
        `Provisioning failed at step "${step}"; tenant is FAILED and can be retried`,
      );
    }
  }

  /** Drops what was created and marks the tenant FAILED (kept, so it can be retried). */
  private async cleanup(tenant: Tenant, reason: string) {
    await this.manager.evict(tenant.id);
    try {
      await this.provisioner.dropDatabase(tenant.dbName, tenant.dbUser);
    } catch (error) {
      this.logger.error({ err: error, tenantId: tenant.id }, 'Could not drop tenant database after failure');
    }
    await this.control.tenant.update({ where: { id: tenant.id }, data: { status: TenantStatus.FAILED, failureReason: reason } });
  }

  private encrypt(password: string) {
    return encryptSecret(password, this.config.getOrThrow('DB_CREDENTIALS_KEY'));
  }
}
