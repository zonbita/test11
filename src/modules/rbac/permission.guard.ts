import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { AUTH_ONLY, IS_PUBLIC, PLATFORM_ONLY } from '../../common/auth/auth.decorators';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import type { RequestContext } from '../../common/logging/request-context';
import { CompanyStatus } from '../../generated/tenant/enums';
import { TenantDbService } from '../tenancy/tenant-db.service';
import { REQUIRED_PERMISSION, RequiredPermission } from './access';
import { EnforcerService } from './enforcer.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Deny by default: every tenant route must declare @RequirePermission, @AuthOnly or @Public.
 * Runs after JwtAuthGuard.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly enforcers: EnforcerService,
    private readonly tenantDb: TenantDbService,
    private readonly logger: PinoLogger,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(PLATFORM_ONLY, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(AUTH_ONLY, targets)) return true;

    const required = this.reflector.getAllAndOverride<RequiredPermission>(REQUIRED_PERMISSION, targets);
    if (!required) throw new AppException(HttpStatus.FORBIDDEN, ErrorCode.PERMISSION_DENIED, 'Route has no permission declared');

    const req = ctx.switchToHttp().getRequest<Request & RequestContext>();
    const userId = req.user!.id;
    const companyId = await this.readCompanyId(req);
    const enforcer = await this.enforcers.forTenant(this.tenantDb.tenantId, this.tenantDb.client);
    const scope = await this.enforcers.resolveScope(enforcer, userId, companyId, required.resource, required.action);
    if (!scope) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.PERMISSION_DENIED,
        `Missing permission ${required.resource}.${required.action}`,
      );
    }

    req.access = { userId, companyId, scope };
    if (companyId) this.logger.assign({ companyId });
    return true;
  }

  /** X-Company-Id must be a uuid of an existing, ACTIVE company of this tenant. */
  private async readCompanyId(req: Request): Promise<string | null> {
    const value = req.header('x-company-id');
    if (!value) return null;
    if (!UUID_RE.test(value)) throw new AppException(HttpStatus.BAD_REQUEST, ErrorCode.BAD_REQUEST, 'Invalid X-Company-Id header');

    const company = await this.tenantDb.client.company.findUnique({ where: { id: value }, select: { status: true } });
    if (!company) throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.COMPANY_NOT_FOUND, 'Company not found');
    if (company.status !== CompanyStatus.ACTIVE) {
      throw new AppException(HttpStatus.FORBIDDEN, ErrorCode.COMPANY_INACTIVE, 'Company is inactive');
    }
    return value;
  }
}
