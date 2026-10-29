import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { IS_PUBLIC, PLATFORM_ONLY } from '../../common/auth/auth.decorators';
import type { JwtPayload } from '../../common/auth/auth.types';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import type { RequestContext } from '../../common/logging/request-context';
import { currentTenant } from '../tenancy/tenant-context';
import { UserStateService } from './user-state.service';

const unauthorized = (code: ErrorCode = ErrorCode.UNAUTHORIZED, message = 'Authentication required') =>
  new AppException(HttpStatus.UNAUTHORIZED, code, message);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly userState: UserStateService,
    private readonly logger: PinoLogger,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request & RequestContext>();
    const payload = await this.verify(req);

    if (this.reflector.getAllAndOverride<boolean>(PLATFORM_ONLY, targets)) {
      if (payload.typ !== 'platform') throw new AppException(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, 'Platform admin token required');
      req.user = { id: payload.sub, type: 'platform' };
      this.logger.assign({ userId: payload.sub, platform: true });
      return true;
    }

    if (payload.typ !== 'tenant') throw new AppException(HttpStatus.FORBIDDEN, ErrorCode.FORBIDDEN, 'Tenant user token required');
    // F02 BR-04: the token's tenant must be the tenant of the subdomain
    const tenant = currentTenant();
    if (!payload.tid || tenant?.tenantId !== payload.tid) {
      throw unauthorized(ErrorCode.WRONG_TENANT, 'Token does not belong to this tenant');
    }
    // F04 AC-04: disabled users and revoked tokens are rejected on the next request
    if (!(await this.userState.isTokenValid(tenant.tenantId, tenant.db, payload.sub, payload.ver))) {
      throw unauthorized(ErrorCode.TOKEN_REVOKED, 'Session revoked');
    }

    req.user = { id: payload.sub, type: 'tenant', tenantId: payload.tid };
    this.logger.assign({ userId: payload.sub });
    return true;
  }

  private async verify(req: Request): Promise<JwtPayload> {
    const [scheme, token] = (req.header('authorization') ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) throw unauthorized();
    try {
      return await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw unauthorized(ErrorCode.UNAUTHORIZED, 'Invalid or expired token');
    }
  }
}
