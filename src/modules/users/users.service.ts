import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { AppException, validationError } from '../../common/errors/app.exception';
import { ErrorCode, FieldError } from '../../common/errors/error-codes';
import type { Prisma } from '../../generated/tenant/client';
import { CompanyStatus, UserStatus } from '../../generated/tenant/enums';
import { hashPassword } from '../auth/password';
import { UserStateService } from '../auth/user-state.service';
import { AccessContext, companyFilter } from '../rbac/access';
import { EnforcerService } from '../rbac/enforcer.service';
import { TENANT_ADMIN_ROLE_KEY } from '../rbac/permission-catalog';
import { PlanLimitsService } from '../tenancy/plan-limits.service';
import { TenantDbService } from '../tenancy/tenant-db.service';
import { CreateUserDto } from './dto/create-user.dto';
import { MembershipDto } from './dto/membership.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const USER_SELECT = {
  id: true,
  email: true,
  fullName: true,
  locale: true,
  status: true,
  mfaEnabled: true,
  lastLoginAt: true,
  createdAt: true,
  memberships: { select: { companyId: true, role: { select: { id: true, key: true, name: true } } } },
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly enforcers: EnforcerService,
    private readonly userState: UserStateService,
    private readonly planLimits: PlanLimitsService,
  ) {}

  list(access: AccessContext) {
    const companyId = companyFilter(access);
    return this.tenantDb.client.user.findMany({
      where: companyId ? { memberships: { some: { OR: [{ companyId }, { companyId: null }] } } } : {},
      select: USER_SELECT,
      orderBy: { fullName: 'asc' },
    });
  }

  async create(dto: CreateUserDto) {
    await this.assertMembershipsValid(dto.memberships);
    await this.planLimits.assertCanAdd('users');
    const passwordHash = await hashPassword(dto.password);
    const user = await this.tenantDb.client.user.create({
      data: {
        email: dto.email.toLowerCase(),
        fullName: dto.fullName,
        locale: dto.locale,
        passwordHash,
        memberships: { create: dto.memberships.map((m) => ({ companyId: m.companyId ?? null, roleId: m.roleId })) },
      },
      select: USER_SELECT,
    });
    await this.enforcers.policyChanged(this.tenantDb.tenantId);
    return user;
  }

  async update(id: string, dto: UpdateUserDto) {
    return this.tenantDb.client.user.update({ where: { id }, data: dto, select: USER_SELECT });
  }

  /** F04 AC-04: disabling revokes every token now (token version bump) and drops the user from the policy. */
  async setStatus(id: string, status: UserStatus) {
    const current = await this.tenantDb.client.user.findUnique({ where: { id }, select: { status: true } });
    if (!current) throw new NotFoundException('User not found');
    if (current.status === status) return this.tenantDb.client.user.findUniqueOrThrow({ where: { id }, select: USER_SELECT });
    if (status === UserStatus.ACTIVE) await this.planLimits.assertCanAdd('users');

    const user = await this.withAdminGuard(async (tx) =>
      tx.user.update({
        where: { id },
        data: { status, ...(status === UserStatus.DISABLED && { tokenVersion: { increment: 1 } }) },
        select: USER_SELECT,
      }),
    );
    await this.userState.changed(this.tenantDb.tenantId, id);
    await this.enforcers.policyChanged(this.tenantDb.tenantId);
    return user;
  }

  async setMemberships(userId: string, memberships: MembershipDto[]) {
    await this.assertMembershipsValid(memberships);
    const user = await this.withAdminGuard(async (tx) => {
      await tx.membership.deleteMany({ where: { userId } });
      await tx.membership.createMany({ data: memberships.map((m) => ({ userId, companyId: m.companyId ?? null, roleId: m.roleId })) });
      return tx.user.findUniqueOrThrow({ where: { id: userId }, select: USER_SELECT });
    });
    await this.enforcers.policyChanged(this.tenantDb.tenantId);
    return user;
  }

  /**
   * F04 BR-01: at least one ACTIVE user must keep the tenant_admin role tenant-wide.
   * Runs the change, then checks, in one transaction; the role row lock serializes concurrent admin changes.
   */
  private async withAdminGuard<T>(change: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.tenantDb.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM roles WHERE key = ${TENANT_ADMIN_ROLE_KEY} FOR UPDATE`;
      const result = await change(tx);
      const admins = await tx.membership.count({
        where: { companyId: null, role: { key: TENANT_ADMIN_ROLE_KEY }, user: { status: UserStatus.ACTIVE } },
      });
      if (admins === 0) {
        throw new AppException(HttpStatus.CONFLICT, ErrorCode.LAST_ADMIN, 'The tenant must keep at least one active Admin tenant');
      }
      return result;
    });
  }

  /** One role per company, and every referenced company/role must exist (company ACTIVE). */
  private async assertMembershipsValid(memberships: MembershipDto[]) {
    const errors: FieldError[] = [];
    const seen = new Set<string>();
    memberships.forEach((m, i) => {
      const key = m.companyId ?? '*';
      if (seen.has(key)) errors.push({ field: `memberships.${i}.companyId`, code: 'duplicate', message: 'One role per company' });
      seen.add(key);
    });

    const db = this.tenantDb.client;
    const companyIds = [...new Set(memberships.map((m) => m.companyId).filter((id): id is string => !!id))];
    const roleIds = [...new Set(memberships.map((m) => m.roleId))];
    const [companies, roles] = await Promise.all([
      db.company.findMany({ where: { id: { in: companyIds }, status: CompanyStatus.ACTIVE }, select: { id: true } }),
      db.role.findMany({ where: { id: { in: roleIds } }, select: { id: true } }),
    ]);
    const okCompanies = new Set(companies.map((c) => c.id));
    const okRoles = new Set(roles.map((r) => r.id));
    memberships.forEach((m, i) => {
      if (m.companyId && !okCompanies.has(m.companyId)) {
        errors.push({ field: `memberships.${i}.companyId`, code: 'notFound', message: 'Unknown or inactive company' });
      }
      if (!okRoles.has(m.roleId)) errors.push({ field: `memberships.${i}.roleId`, code: 'notFound', message: 'Unknown role' });
    });
    if (errors.length > 0) throw validationError(errors);
  }
}
