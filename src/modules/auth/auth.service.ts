import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { JwtPayload } from '../../common/auth/auth.types';
import { UserStatus } from '../../generated/tenant/enums';
import { effectiveScope } from '../rbac/casbin/subjects';
import { TenantDbService } from '../tenancy/tenant-db.service';
import { LoginDto } from './dto/login.dto';
import { assertNotLocked, invalidCredentials, LockoutPolicy, onFailedAttempt, RESET_LOCKOUT } from './login-lockout';
import { burnPasswordCheck, verifyPassword } from './password';

@Injectable()
export class AuthService {
  private readonly lockout: LockoutPolicy;

  constructor(
    private readonly tenantDb: TenantDbService,
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.lockout = {
      maxAttempts: config.getOrThrow<number>('LOGIN_MAX_ATTEMPTS'),
      lockMinutes: config.getOrThrow<number>('LOGIN_LOCK_MINUTES'),
    };
  }

  async login(dto: LoginDto) {
    const db = this.tenantDb.client;
    const user = await db.user.findUnique({ where: { email: dto.email.toLowerCase() } });

    if (!user || user.status !== UserStatus.ACTIVE || !user.passwordHash) {
      await burnPasswordCheck(dto.password);
      throw invalidCredentials();
    }
    assertNotLocked(user);

    if (!(await verifyPassword(user.passwordHash, dto.password))) {
      await db.user.update({ where: { id: user.id }, data: onFailedAttempt(user, this.lockout) });
      throw invalidCredentials();
    }

    await db.user.update({ where: { id: user.id }, data: { ...RESET_LOCKOUT, lastLoginAt: new Date() } });
    const payload: JwtPayload = { sub: user.id, typ: 'tenant', tid: this.tenantDb.tenantId, ver: user.tokenVersion };
    return { accessToken: await this.jwt.signAsync(payload) };
  }

  /** Profile + permissions per membership, for the UI to show/hide components. Casbin remains the only enforcement. */
  async me(userId: string) {
    const { memberships, ...user } = await this.tenantDb.client.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        locale: true,
        status: true,
        mfaEnabled: true,
        memberships: {
          orderBy: { createdAt: 'asc' },
          select: {
            company: { select: { id: true, legalName: true, status: true } },
            role: {
              select: {
                id: true,
                key: true,
                name: true,
                permissions: {
                  orderBy: [{ permission: { resource: 'asc' } }, { permission: { action: 'asc' } }],
                  select: { scope: true, permission: { select: { resource: true, action: true } } },
                },
              },
            },
          },
        },
      },
    });

    return {
      ...user,
      memberships: memberships.map(({ company, role: { permissions, ...role } }) => ({
        company,
        role,
        permissions: permissions.map(({ scope, permission }) => ({
          resource: permission.resource,
          action: permission.action,
          scope: effectiveScope(scope, company?.id ?? null),
        })),
      })),
    };
  }
}
