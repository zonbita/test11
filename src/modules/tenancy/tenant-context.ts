import { AsyncLocalStorage } from 'node:async_hooks';
import type { TenantPrismaClient } from '../../database/tenant-prisma.manager';

export interface TenantContextValue {
  tenantId: string;
  subdomain: string;
  planId: string;
  db: TenantPrismaClient;
}

/** Request-scoped tenant context, set by TenantResolverMiddleware from the Host subdomain. */
export const tenantStorage = new AsyncLocalStorage<TenantContextValue>();

export function currentTenant(): TenantContextValue | undefined {
  return tenantStorage.getStore();
}
