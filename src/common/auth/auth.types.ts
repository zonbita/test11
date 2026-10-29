export type TokenType = 'tenant' | 'platform';

export interface JwtPayload {
  sub: string;
  typ: TokenType;
  // Tenant id, only for typ = 'tenant'
  tid?: string;
  // User token version; a bump revokes every token issued before it
  ver?: number;
}

export interface AuthUser {
  id: string;
  type: TokenType;
  tenantId?: string;
}
