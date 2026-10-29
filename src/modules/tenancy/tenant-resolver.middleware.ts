import { HttpStatus, Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import type { RequestContext } from '../../common/logging/request-context';
import { TenantStatus } from '../../generated/control/enums';
import { tenantStorage } from './tenant-context';
import { TenantRegistryService } from './tenant-registry.service';

/**
 * Resolves the tenant from the Host subdomain (dfm.app.com -> "dfm").
 * Never from a header, query or body param sent by the client.
 * Requests to the bare base domain (platform API) run without tenant context.
 */
@Injectable()
export class TenantResolverMiddleware implements NestMiddleware {
  private readonly baseDomain: string;

  constructor(
    private readonly registry: TenantRegistryService,
    private readonly logger: PinoLogger,
    config: ConfigService,
  ) {
    this.baseDomain = config.getOrThrow<string>('APP_BASE_DOMAIN').toLowerCase();
  }

  async use(req: Request & RequestContext, _res: Response, next: NextFunction) {
    const subdomain = this.extractSubdomain(req.hostname);
    if (!subdomain) return next();

    try {
      const tenant = await this.registry.findBySubdomain(subdomain);
      if (tenant?.status === TenantStatus.SUSPENDED) {
        throw new AppException(HttpStatus.FORBIDDEN, ErrorCode.TENANT_SUSPENDED, 'Tenant is suspended');
      }
      if (tenant?.status !== TenantStatus.ACTIVE) {
        throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.TENANT_NOT_FOUND, 'Tenant not found');
      }

      req.tenant = { id: tenant.id, subdomain };
      this.logger.assign({ tenant: subdomain, tenantId: tenant.id });
      const ctx = { tenantId: tenant.id, subdomain, planId: tenant.planId, db: this.registry.clientFor(tenant) };
      tenantStorage.run(ctx, () => next());
    } catch (error) {
      next(error);
    }
  }

  private extractSubdomain(hostname: string | undefined): string | null {
    const host = (hostname ?? '').toLowerCase();
    const suffix = `.${this.baseDomain}`;
    if (!host.endsWith(suffix)) return null;
    const sub = host.slice(0, -suffix.length);
    return /^[a-z0-9-]+$/.test(sub) ? sub : null;
  }
}
