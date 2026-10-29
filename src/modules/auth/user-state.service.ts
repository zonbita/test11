import { Injectable } from '@nestjs/common';
import { ControlEventsService } from '../../database/control-events.service';
import type { TenantPrismaClient } from '../../database/tenant-prisma.manager';
import { UserStatus } from '../../generated/tenant/enums';

// Upper bound on staleness if a NOTIFY is missed; normally invalidated immediately.
const CACHE_TTL_MS = 30_000;

interface UserState {
  status: UserStatus;
  tokenVersion: number;
}

/**
 * Per-request check that a token's user is still ACTIVE and the token not revoked (F04 AC-04),
 * without hitting the DB on every request.
 */
@Injectable()
export class UserStateService {
  private readonly cache = new Map<string, { state: UserState | null; expiresAt: number }>();

  constructor(private readonly events: ControlEventsService) {
    events.subscribe((event) => {
      if (event.kind === 'user') this.cache.delete(key(event.tenantId, event.userId));
    });
  }

  async isTokenValid(tenantId: string, db: TenantPrismaClient, userId: string, tokenVersion: number | undefined) {
    const state = await this.get(tenantId, db, userId);
    return state?.status === UserStatus.ACTIVE && state.tokenVersion === (tokenVersion ?? 0);
  }

  /** Call after changing a user's status or token version (inside the request that changed it). */
  async changed(tenantId: string, userId: string) {
    await this.events.publish({ kind: 'user', tenantId, userId });
  }

  private async get(tenantId: string, db: TenantPrismaClient, userId: string): Promise<UserState | null> {
    const k = key(tenantId, userId);
    const cached = this.cache.get(k);
    if (cached && cached.expiresAt > Date.now()) return cached.state;
    const state = await db.user.findUnique({ where: { id: userId }, select: { status: true, tokenVersion: true } });
    this.cache.set(k, { state, expiresAt: Date.now() + CACHE_TTL_MS });
    return state;
  }
}

const key = (tenantId: string, userId: string) => `${tenantId}:${userId}`;
