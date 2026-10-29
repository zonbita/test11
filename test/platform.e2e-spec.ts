import { NestExpressApplication } from '@nestjs/platform-express';
import { hashPassword } from '../src/modules/auth/password';
import { ADMIN_PASSWORD, Api, createTestApp, hostOf, uniqueSubdomain } from './support/app';
import { withAdmin, withControl } from './support/db';

describe('Platform: tenants & Super Admin (F01)', () => {
  let app: NestExpressApplication;
  let api: Api;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    api = new Api(app);
    token = await api.platformToken();
  });
  afterAll(() => app.close());

  describe('provisioning', () => {
    let tenant: { id: string; subdomain: string; status: string; schema_version: string };

    beforeAll(async () => {
      tenant = await api.createTenant(token, uniqueSubdomain('prov'));
    });

    it('creates an ACTIVE tenant with its own database, records the schema version, never returns DB credentials', async () => {
      expect(tenant.status).toBe('ACTIVE');
      expect(tenant.schema_version).toMatch(/^\d{14}_/);
      const res = await api.call('get', `/platform/api/v1/tenants/${tenant.id}`, { token });
      expect(res.status).toBe(200);
      expect(Object.keys(res.body)).not.toEqual(expect.arrayContaining(['db_password_enc']));
      expect(JSON.stringify(res.body)).not.toMatch(/db_?password|db_?user|db_?host/i);

      const { rows } = await withAdmin((c) =>
        c.query('SELECT 1 FROM pg_database WHERE datname = $1', [`tenant_e2e_${tenant.subdomain.replace(/-/g, '_')}`]),
      );
      expect(rows).toHaveLength(1);
    });

    it('seeds the tenant admin who can log in on the subdomain', async () => {
      await expect(api.adminLogin(tenant.subdomain)).resolves.toEqual(expect.any(String));
    });

    it('rejects a duplicate subdomain with 422 SUBDOMAIN_TAKEN (AC-02)', async () => {
      const res = await api.call('post', '/platform/api/v1/tenants', {
        token,
        body: {
          name: 'dup',
          subdomain: tenant.subdomain,
          company_legal_name: 'X',
          admin_email: 'a@b.test',
          admin_full_name: 'A',
          admin_password: ADMIN_PASSWORD,
        },
      });
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ code: 'SUBDOMAIN_TAKEN', fields: [expect.objectContaining({ field: 'subdomain' })] });
    });

    it.each([
      ['reserved', 'admin', 'SUBDOMAIN_RESERVED'],
      ['too short', 'ab', 'VALIDATION_FAILED'],
      ['too long (31)', 'a'.repeat(31), 'VALIDATION_FAILED'],
      ['uppercase', 'Dfm', 'VALIDATION_FAILED'],
    ])('rejects a %s subdomain with 422', async (_label, subdomain, code) => {
      const res = await api.call('post', '/platform/api/v1/tenants', {
        token,
        body: {
          name: 'x',
          subdomain,
          company_legal_name: 'X',
          admin_email: 'a@b.test',
          admin_full_name: 'A',
          admin_password: ADMIN_PASSWORD,
        },
      });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe(code);
    });

    it('rejects a weak admin password (F02 BR-01: >= 12 chars, not common)', async () => {
      for (const admin_password of ['Short-123', 'password1234']) {
        const res = await api.call('post', '/platform/api/v1/tenants', {
          token,
          body: {
            name: 'x',
            subdomain: uniqueSubdomain('weak'),
            company_legal_name: 'X',
            admin_email: 'a@b.test',
            admin_full_name: 'A',
            admin_password,
          },
        });
        expect(res.status).toBe(422);
        expect(res.body.fields).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'admin_password' })]));
      }
    });
  });

  describe('lifecycle state machine (BR-03)', () => {
    let tenant: { id: string; subdomain: string };
    let tenantToken: string;
    const setStatus = (status: string) => api.call('patch', `/platform/api/v1/tenants/${tenant.id}/status`, { token, body: { status } });

    beforeAll(async () => {
      tenant = await api.createTenant(token, uniqueSubdomain('life'));
      tenantToken = await api.adminLogin(tenant.subdomain);
    });

    it('SUSPENDED blocks every tenant request with 403 TENANT_SUSPENDED (AC-04), ACTIVE restores it', async () => {
      expect((await setStatus('SUSPENDED')).status).toBe(200);
      const me = await api.call('get', '/api/v1/auth/me', { host: hostOf(tenant.subdomain), token: tenantToken });
      expect(me.status).toBe(403);
      expect(me.body.code).toBe('TENANT_SUSPENDED');

      expect((await setStatus('ACTIVE')).status).toBe(200);
      expect((await api.call('get', '/api/v1/auth/me', { host: hostOf(tenant.subdomain), token: tenantToken })).status).toBe(200);
    });

    it('ACTIVE cannot go straight to DELETED: suspend first (409 INVALID_STATUS_TRANSITION)', async () => {
      const res = await setStatus('DELETED');
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('INVALID_STATUS_TRANSITION');
    });

    it('SUSPENDED -> DELETED blocks access immediately and is final (409 on any further transition)', async () => {
      expect((await setStatus('SUSPENDED')).status).toBe(200);
      expect((await setStatus('DELETED')).status).toBe(200);
      const me = await api.call('get', '/api/v1/auth/me', { host: hostOf(tenant.subdomain), token: tenantToken });
      expect(me.status).toBe(404);
      expect(me.body.code).toBe('TENANT_NOT_FOUND');

      for (const status of ['ACTIVE', 'SUSPENDED']) {
        const res = await setStatus(status);
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('INVALID_STATUS_TRANSITION');
      }
    });
  });

  describe('failed provisioning (AC-03)', () => {
    const subdomain = uniqueSubdomain('fail');
    const role = `tenant_e2e_${subdomain.replace(/-/g, '_')}`;

    it('cleans up, marks the tenant FAILED, and succeeds on retry', async () => {
      // Make step "create database" fail: the tenant role already exists
      await withAdmin((c) => c.query(`CREATE ROLE "${role}"`));

      const failed = await api.call('post', '/platform/api/v1/tenants', {
        token,
        body: {
          name: 'fail',
          subdomain,
          plan_code: 'business',
          company_legal_name: 'F SAS',
          admin_email: `admin@${subdomain}.test`,
          admin_full_name: 'A',
          admin_password: ADMIN_PASSWORD,
        },
      });
      expect(failed.status).toBe(500);
      expect(failed.body).toMatchObject({ code: 'PROVISIONING_FAILED', request_id: expect.any(String) });

      const { rows } = await withControl((c) =>
        c.query('SELECT id, status, failure_reason FROM tenants WHERE subdomain = $1', [subdomain]),
      );
      expect(rows[0]).toMatchObject({ status: 'FAILED', failure_reason: expect.stringContaining('create database') });
      const leftovers = await withAdmin((c) => c.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]));
      expect(leftovers.rows).toHaveLength(0);

      const retry = await api.call('post', `/platform/api/v1/tenants/${rows[0].id}/retry`, {
        token,
        body: { admin_password: ADMIN_PASSWORD },
      });
      expect(retry.status).toBe(201);
      expect(retry.body.status).toBe('ACTIVE');
      await expect(api.adminLogin(subdomain)).resolves.toEqual(expect.any(String));

      // Only FAILED tenants can be retried
      const again = await api.call('post', `/platform/api/v1/tenants/${rows[0].id}/retry`, {
        token,
        body: { admin_password: ADMIN_PASSWORD },
      });
      expect(again.status).toBe(409);
    });
  });

  describe('Super Admin login', () => {
    const email = `locked-${Date.now()}@platform.test`;

    beforeAll(async () => {
      const hash = await hashPassword('Locked-Admin-2026');
      await withControl((c) =>
        c.query('INSERT INTO platform_admins (id, email, password_hash, updated_at) VALUES (gen_random_uuid(), $1, $2, now())', [
          email,
          hash,
        ]),
      );
    });
    afterAll(() => withControl((c) => c.query('DELETE FROM platform_admins WHERE email = $1', [email])));

    it('locks the account with 423 ACCOUNT_LOCKED after 5 failures, even with the right password (C11)', async () => {
      for (let i = 0; i < 5; i++) {
        const res = await api.call('post', '/platform/api/v1/auth/login', { body: { email, password: 'Wrong-Password-1' } });
        expect(res.status).toBe(401);
        expect(res.body.code).toBe('INVALID_CREDENTIALS');
      }
      const locked = await api.call('post', '/platform/api/v1/auth/login', { body: { email, password: 'Locked-Admin-2026' } });
      expect(locked.status).toBe(423);
      expect(locked.body.code).toBe('ACCOUNT_LOCKED');
    });

    it('rejects tenant tokens on platform routes and platform tokens on tenant routes', async () => {
      const t = await api.createTenant(token, uniqueSubdomain('tok'));
      const tenantToken = await api.adminLogin(t.subdomain);
      expect((await api.call('get', '/platform/api/v1/tenants', { token: tenantToken })).status).toBe(403);
      expect((await api.call('get', '/api/v1/auth/me', { host: hostOf(t.subdomain), token })).status).toBe(403);
    });
  });
});
