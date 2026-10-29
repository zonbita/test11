import { ExecutionContext, SetMetadata } from '@nestjs/common';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import type { EnvironmentVariables } from '../../config/env.validation';

const MINUTE_MS = 60_000;
const IS_LOGIN_ROUTE = 'throttle:login';

/**
 * Stricter per-IP rate limit for login endpoints. Brute force on one account is additionally
 * stopped by the account lockout (F02 AC-03: 5 failures / 15 min -> 423).
 */
export const LoginThrottle = () => SetMetadata(IS_LOGIN_ROUTE, true);

export function buildThrottlerOptions(
  env: Pick<EnvironmentVariables, 'THROTTLE_DEFAULT_LIMIT' | 'THROTTLE_LOGIN_LIMIT'>,
): ThrottlerModuleOptions {
  return {
    throttlers: [
      { name: 'default', ttl: MINUTE_MS, limit: env.THROTTLE_DEFAULT_LIMIT },
      {
        name: 'login',
        ttl: MINUTE_MS,
        limit: env.THROTTLE_LOGIN_LIMIT,
        skipIf: (ctx: ExecutionContext) => !Reflect.getMetadata(IS_LOGIN_ROUTE, ctx.getHandler()),
      },
    ],
    errorMessage: 'Too many requests, slow down',
  };
}
