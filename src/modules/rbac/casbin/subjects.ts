import { DataScope } from '../../../generated/tenant/enums';

export const ANY_DOMAIN = '*';

export const userSubject = (userId: string) => `user:${userId}`;
export const roleSubject = (roleId: string) => `role:${roleId}`;
export const companyDomain = (companyId: string | null) => (companyId ? `company:${companyId}` : ANY_DOMAIN);

const SCOPE_RANK: Record<DataScope, number> = {
  [DataScope.OWN]: 1,
  [DataScope.COMPANY]: 2,
  [DataScope.TENANT]: 3,
};

/** Widest first: the guard keeps the first scope the user is allowed. */
export const SCOPES_WIDEST_FIRST: DataScope[] = [DataScope.TENANT, DataScope.COMPANY, DataScope.OWN];

/** Casbin matcher function: a policy granted at `granted` scope covers a request at `requested` scope. */
export function scopeCovers(granted: string, requested: string): boolean {
  const g = SCOPE_RANK[granted as DataScope];
  const r = SCOPE_RANK[requested as DataScope];
  return g !== undefined && r !== undefined && g >= r;
}
