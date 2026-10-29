import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from './auth.types';

export const IS_PUBLIC = 'auth:public';
export const AUTH_ONLY = 'auth:authOnly';
export const PLATFORM_ONLY = 'auth:platformOnly';

/** No authentication required. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Any authenticated tenant user, no permission check (e.g. /auth/me). */
export const AuthOnly = () => SetMetadata(AUTH_ONLY, true);

/** Super admin routes: requires a platform token, rejects tenant tokens. */
export const PlatformOnly = () => SetMetadata(PLATFORM_ONLY, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest<Request & { user: AuthUser }>().user;
});
