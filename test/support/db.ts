import { Client } from 'pg';
import { decryptSecret } from '../../src/common/crypto/secret-box';

/** Every tenant created by the e2e suite uses this subdomain prefix. */
export const E2E_PREFIX = 'e2e-';

async function withClient<T>(connectionString: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export const withAdmin = <T>(fn: (c: Client) => Promise<T>) => withClient(process.env.TENANT_DB_ADMIN_URL!, fn);
export const withControl = <T>(fn: (c: Client) => Promise<T>) => withClient(process.env.CONTROL_DATABASE_URL!, fn);

export interface TenantCredentials {
  id: string;
  dbName: string;
  dbUser: string;
  password: string;
  host: string;
  port: number;
}

/** Real DB credentials of a tenant, read from the control plane (as the API would). */
export async function tenantCredentials(subdomain: string): Promise<TenantCredentials> {
  const { rows } = await withControl((c) =>
    c.query('SELECT id, db_name, db_user, db_password_enc, db_host, db_port FROM tenants WHERE subdomain = $1', [subdomain]),
  );
  const t = rows[0];
  return {
    id: t.id,
    dbName: t.db_name,
    dbUser: t.db_user,
    password: decryptSecret(t.db_password_enc, process.env.DB_CREDENTIALS_KEY!),
    host: t.db_host,
    port: t.db_port,
  };
}

/** Connection string as tenant `creds` to database `dbName` (defaults to its own). */
export const tenantUrl = (creds: TenantCredentials, dbName = creds.dbName) =>
  `postgresql://${creds.dbUser}:${encodeURIComponent(creds.password)}@${creds.host}:${creds.port}/${dbName}`;

export const withTenantDb = async <T>(subdomain: string, fn: (c: Client) => Promise<T>) =>
  withClient(tenantUrl(await tenantCredentials(subdomain)), fn);

/** Drops databases, roles and control rows of every e2e tenant. */
export async function purgeE2eTenants() {
  const like = `${E2E_PREFIX}%`;
  const roleLike = `tenant_${E2E_PREFIX.replace(/-/g, '_')}%`;
  const { rows } = await withControl((c) => c.query('SELECT db_name, db_user FROM tenants WHERE subdomain LIKE $1', [like]));
  await withAdmin(async (admin) => {
    const dbs = await admin.query('SELECT datname FROM pg_database WHERE datname LIKE $1', [roleLike]);
    const roles = await admin.query('SELECT rolname FROM pg_roles WHERE rolname LIKE $1', [roleLike]);
    const names = new Set([...rows.map((r) => r.db_name), ...dbs.rows.map((r) => r.datname)]);
    for (const db of names) await admin.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    const users = new Set([...rows.map((r) => r.db_user), ...roles.rows.map((r) => r.rolname)]);
    for (const role of users) await admin.query(`DROP ROLE IF EXISTS "${role}"`);
  });
  await withControl((c) => c.query('DELETE FROM tenants WHERE subdomain LIKE $1', [like]));
}
