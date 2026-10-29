import { NestExpressApplication } from '@nestjs/platform-express';
import { Api, billingAddress, createTestApp, hostOf, uniqueSubdomain, USER_PASSWORD } from './support/app';
import { withTenantDb } from './support/db';

/** Casbin with the real Prisma adapter, through the HTTP guards (F04). */
describe('RBAC & users (F04)', () => {
  let app: NestExpressApplication;
  let api: Api;
  const sub = uniqueSubdomain('rbac');
  const host = hostOf(sub);
  let admin: string;
  let companyA: string;
  let companyB: string;
  const roles: Record<string, string> = {};

  const call = (method: Parameters<Api['call']>[0], path: string, opts: Parameters<Api['call']>[2] = {}) =>
    api.call(method, path, { host, ...opts });

  async function createUser(email: string, memberships: { companyId: string | null; roleId: string }[]) {
    const res = await call('post', '/api/v1/users', {
      token: admin,
      body: { email, fullName: email, password: USER_PASSWORD, memberships },
    });
    if (res.status !== 201) throw new Error(`createUser ${res.status} ${JSON.stringify(res.body)}`);
    return { id: res.body.id as string, token: await api.login(sub, email, USER_PASSWORD) };
  }

  beforeAll(async () => {
    app = await createTestApp();
    api = new Api(app);
    await api.createTenant(await api.platformToken(), sub, { plan: 'business' });
    admin = await api.adminLogin(sub);
    companyA = (await call('get', '/api/v1/companies', { token: admin })).body[0].id;
    companyB = (
      await call('post', '/api/v1/companies', { token: admin, body: { legalName: 'DFM NEW YORK', countryCode: 'US', currency: 'USD' } })
    ).body.id;
    for (const r of (await call('get', '/api/v1/roles', { token: admin })).body) roles[r.key] = r.id;
  });
  afterAll(() => app.close());

  it('seeds the 5 system roles of PRD §1.8, without wildcard grants', async () => {
    const res = await call('get', '/api/v1/roles', { token: admin });
    expect(res.body.map((r: { key: string }) => r.key).sort()).toEqual(['accountant', 'owner', 'sales', 'tenant_admin', 'viewer']);
    const grants = res.body.flatMap((r: { grants: { resource: string; action: string }[] }) => r.grants);
    expect(grants.some((g: { resource: string; action: string }) => g.resource === '*' || g.action === '*')).toBe(false);
    const viewer = res.body.find((r: { key: string }) => r.key === 'viewer');
    expect(viewer.grants.map((g: { resource: string }) => g.resource)).not.toContain('audit');
  });

  describe('data scope', () => {
    let sale1: { id: string; token: string };
    let sale2: { id: string; token: string };
    let owner: { id: string; token: string };
    let c2: string;

    beforeAll(async () => {
      sale1 = await createUser(`sale1@${sub}.test`, [{ companyId: companyA, roleId: roles.sales }]);
      sale2 = await createUser(`sale2@${sub}.test`, [{ companyId: companyA, roleId: roles.sales }]);
      owner = await createUser(`owner@${sub}.test`, [{ companyId: companyA, roleId: roles.owner }]);
      await call('post', '/api/v1/customers', {
        token: sale1.token,
        company: companyA,
        body: { type: 'COMPANY', name: 'S1 client', addresses: [billingAddress] },
      });
      c2 = (
        await call('post', '/api/v1/customers', {
          token: sale2.token,
          company: companyA,
          body: { type: 'COMPANY', name: 'S2 client', addresses: [billingAddress] },
        })
      ).body.id;
    });

    it('sales sees only own customers (AC-02/BR-03), owner sees the whole company', async () => {
      expect((await call('get', '/api/v1/customers', { token: sale1.token, company: companyA })).body.total).toBe(1);
      expect((await call('get', '/api/v1/customers', { token: owner.token, company: companyA })).body.total).toBe(2);
    });

    it("direct access to another sale's customer answers 403 OUT_OF_SCOPE (AC-03)", async () => {
      for (const [method, path] of [
        ['get', `/api/v1/customers/${c2}`],
        ['patch', `/api/v1/customers/${c2}`],
      ] as const) {
        const res = await call(method, path, {
          token: sale1.token,
          company: companyA,
          body: method === 'patch' ? { notes: 'x' } : undefined,
        });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('OUT_OF_SCOPE');
      }
    });

    it('sharing makes the customer visible; the share target must be an active member of the company (B5)', async () => {
      const outsider = await createUser(`ny@${sub}.test`, [{ companyId: companyB, roleId: roles.sales }]);
      const bad = await call('post', `/api/v1/customers/${c2}/shares`, {
        token: sale2.token,
        company: companyA,
        body: { userId: outsider.id },
      });
      expect(bad.status).toBe(422);
      expect(bad.body.code).toBe('INVALID_ASSIGNEE');

      expect(
        (await call('post', `/api/v1/customers/${c2}/shares`, { token: sale2.token, company: companyA, body: { userId: sale1.id } }))
          .status,
      ).toBe(204);
      expect((await call('get', '/api/v1/customers', { token: sale1.token, company: companyA })).body.total).toBe(2);
    });

    it('sales cannot reassign owner; owner can only assign to a member of the company', async () => {
      const own = await call('post', '/api/v1/customers', {
        token: sale1.token,
        company: companyA,
        body: { type: 'COMPANY', name: 'x', ownerId: sale2.id, addresses: [billingAddress] },
      });
      expect(own.status).toBe(403);
      const outsider = (await call('get', '/api/v1/users', { token: admin })).body.find(
        (u: { email: string }) => u.email === `ny@${sub}.test`,
      );
      const res = await call('patch', `/api/v1/customers/${c2}`, { token: owner.token, company: companyA, body: { ownerId: outsider.id } });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('INVALID_ASSIGNEE');
    });

    it('a user holds different roles in different companies', async () => {
      const multi = await createUser(`multi@${sub}.test`, [
        { companyId: companyA, roleId: roles.viewer },
        { companyId: companyB, roleId: roles.sales },
      ]);
      expect((await call('get', '/api/v1/customers', { token: multi.token, company: companyA })).body.total).toBe(2);
      expect(
        (
          await call('post', '/api/v1/customers', {
            token: multi.token,
            company: companyA,
            body: { type: 'COMPANY', name: 'x', addresses: [billingAddress] },
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await call('post', '/api/v1/customers', {
            token: multi.token,
            company: companyB,
            body: { type: 'COMPANY', name: 'NY', addresses: [billingAddress] },
          })
        ).status,
      ).toBe(201);
    });
  });

  describe('company header (B2)', () => {
    it('rejects malformed, unknown and inactive companies', async () => {
      const malformed = await call('get', '/api/v1/customers', { token: admin, company: 'abc' });
      expect(malformed.status).toBe(400);
      const unknown = await call('get', '/api/v1/customers', { token: admin, company: '00000000-0000-4000-8000-000000000000' });
      expect(unknown.status).toBe(404);
      expect(unknown.body.code).toBe('COMPANY_NOT_FOUND');

      const extra = (await call('post', '/api/v1/companies', { token: admin, body: { legalName: 'TEMP', countryCode: 'US' } })).body.id;
      expect((await call('patch', `/api/v1/companies/${extra}`, { token: admin, body: { status: 'INACTIVE' } })).status).toBe(200);
      const inactive = await call('get', '/api/v1/customers', { token: admin, company: extra });
      expect(inactive.status).toBe(403);
      expect(inactive.body.code).toBe('COMPANY_INACTIVE');
    });
  });

  describe('privilege escalation (B1)', () => {
    it('a role granting TENANT scope, assigned to one company, cannot act tenant-wide', async () => {
      const custom = await call('post', '/api/v1/roles', {
        token: admin,
        body: { key: 'pseudo_admin', name: 'Pseudo admin', grants: [{ resource: 'user', action: 'manage', scope: 'TENANT' }] },
      });
      expect(custom.status).toBe(201);
      const pseudo = await createUser(`pseudo@${sub}.test`, [{ companyId: companyA, roleId: custom.body.id }]);

      const res = await call('post', '/api/v1/users', {
        token: pseudo.token,
        company: companyA,
        body: {
          email: `evil@${sub}.test`,
          fullName: 'Evil',
          password: USER_PASSWORD,
          memberships: [{ companyId: null, roleId: roles.tenant_admin }],
        },
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('TENANT_SCOPE_REQUIRED');
      expect((await call('get', '/api/v1/users', { token: pseudo.token })).status).toBe(403);
    });

    it('system roles cannot be modified (409 SYSTEM_ROLE_LOCKED)', async () => {
      const res = await call('patch', `/api/v1/roles/${roles.sales}`, { token: admin, body: { grants: [] } });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('SYSTEM_ROLE_LOCKED');
    });

    it('custom role changes apply on the next request (policy reload)', async () => {
      const role = await call('post', '/api/v1/roles', {
        token: admin,
        body: { key: 'reader', name: 'Reader', grants: [{ resource: 'customer', action: 'read', scope: 'COMPANY' }] },
      });
      const reader = await createUser(`reader@${sub}.test`, [{ companyId: companyA, roleId: role.body.id }]);
      expect((await call('get', '/api/v1/customers', { token: reader.token, company: companyA })).status).toBe(200);
      expect((await call('patch', `/api/v1/roles/${role.body.id}`, { token: admin, body: { grants: [] } })).status).toBe(204);
      expect((await call('get', '/api/v1/customers', { token: reader.token, company: companyA })).status).toBe(403);
    });
  });

  describe('disabling users (AC-04, B7)', () => {
    it('revokes every token immediately, including on @AuthOnly routes; re-enabling needs a new login', async () => {
      const user = await createUser(`gone@${sub}.test`, [{ companyId: companyA, roleId: roles.viewer }]);
      expect((await call('get', '/api/v1/auth/me', { token: user.token })).status).toBe(200);

      expect((await call('patch', `/api/v1/users/${user.id}/status`, { token: admin, body: { status: 'DISABLED' } })).status).toBe(200);
      for (const path of ['/api/v1/auth/me', '/api/v1/companies']) {
        const res = await call('get', path, { token: user.token });
        expect(res.status).toBe(401);
        expect(res.body.code).toBe('TOKEN_REVOKED');
      }
      const login = await call('post', '/api/v1/auth/login', { body: { email: `gone@${sub}.test`, password: USER_PASSWORD } });
      expect(login.status).toBe(401);

      await call('patch', `/api/v1/users/${user.id}/status`, { token: admin, body: { status: 'ACTIVE' } });
      expect((await call('get', '/api/v1/auth/me', { token: user.token })).status).toBe(401);
      const fresh = await api.login(sub, `gone@${sub}.test`, USER_PASSWORD);
      expect((await call('get', '/api/v1/auth/me', { token: fresh })).status).toBe(200);
    });
  });

  describe('last admin (BR-01)', () => {
    it('refuses to disable or demote the last active tenant admin with 409 LAST_ADMIN', async () => {
      const me = (await call('get', '/api/v1/auth/me', { token: admin })).body;
      const disable = await call('patch', `/api/v1/users/${me.id}/status`, { token: admin, body: { status: 'DISABLED' } });
      expect(disable.status).toBe(409);
      expect(disable.body.code).toBe('LAST_ADMIN');

      const demote = await call('put', `/api/v1/users/${me.id}/memberships`, {
        token: admin,
        body: { memberships: [{ companyId: companyA, roleId: roles.tenant_admin }] },
      });
      expect(demote.status).toBe(409);
      expect(demote.body.code).toBe('LAST_ADMIN');
      // Nothing changed
      expect((await call('get', '/api/v1/auth/me', { token: admin })).status).toBe(200);
    });

    it('allows it once another admin exists', async () => {
      const second = await createUser(`admin2@${sub}.test`, [{ companyId: null, roleId: roles.tenant_admin }]);
      const res = await call('patch', `/api/v1/users/${second.id}/status`, { token: admin, body: { status: 'DISABLED' } });
      expect(res.status).toBe(200);
    });
  });

  describe('memberships validation', () => {
    it('rejects unknown roles/companies and duplicate companies with 422', async () => {
      const res = await call('post', '/api/v1/users', {
        token: admin,
        body: {
          email: `bad@${sub}.test`,
          fullName: 'Bad',
          password: USER_PASSWORD,
          memberships: [
            { companyId: companyA, roleId: '00000000-0000-4000-8000-000000000000' },
            { companyId: companyA, roleId: roles.viewer },
            { companyId: '00000000-0000-4000-8000-000000000001', roleId: roles.viewer },
          ],
        },
      });
      expect(res.status).toBe(422);
      expect(res.body.fields.map((f: { field: string }) => f.field).sort()).toEqual([
        'memberships.0.roleId',
        'memberships.1.companyId',
        'memberships.2.companyId',
      ]);
    });
  });

  describe('lockout (F02 AC-03)', () => {
    it('locks a tenant user with 423 after 5 failures', async () => {
      await createUser(`lock@${sub}.test`, [{ companyId: companyA, roleId: roles.viewer }]);
      for (let i = 0; i < 5; i++) {
        expect(
          (await call('post', '/api/v1/auth/login', { body: { email: `lock@${sub}.test`, password: 'Wrong-Password-1' } })).status,
        ).toBe(401);
      }
      const res = await call('post', '/api/v1/auth/login', { body: { email: `lock@${sub}.test`, password: USER_PASSWORD } });
      expect(res.status).toBe(423);
      expect(res.body.code).toBe('ACCOUNT_LOCKED');
    });
  });
});

describe('Plan limits (F01 BR-04)', () => {
  let app: NestExpressApplication;
  let api: Api;
  const sub = uniqueSubdomain('plan');

  beforeAll(async () => {
    app = await createTestApp();
    api = new Api(app);
    await api.createTenant(await api.platformToken(), sub, { plan: 'starter' });
  });
  afterAll(() => app.close());

  it('starter plan: 1 company, 5 users -> 402 PLAN_LIMIT_REACHED', async () => {
    const host = hostOf(sub);
    const admin = await api.adminLogin(sub);
    const company = await api.call('post', '/api/v1/companies', { host, token: admin, body: { legalName: 'SECOND', countryCode: 'US' } });
    expect(company.status).toBe(402);
    expect(company.body.code).toBe('PLAN_LIMIT_REACHED');

    const roleId = await withTenantDb(sub, async (db) => (await db.query(`SELECT id FROM roles WHERE key = 'viewer'`)).rows[0].id);
    // The admin is user #1
    for (let i = 2; i <= 5; i++) {
      const res = await api.call('post', '/api/v1/users', {
        host,
        token: admin,
        body: { email: `u${i}@${sub}.test`, fullName: `U${i}`, password: USER_PASSWORD, memberships: [{ companyId: null, roleId }] },
      });
      expect(res.status).toBe(201);
    }
    const sixth = await api.call('post', '/api/v1/users', {
      host,
      token: admin,
      body: { email: `u6@${sub}.test`, fullName: 'U6', password: USER_PASSWORD, memberships: [{ companyId: null, roleId }] },
    });
    expect(sixth.status).toBe(402);
    expect(sixth.body.code).toBe('PLAN_LIMIT_REACHED');
  });
});
