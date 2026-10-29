import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/common/http/configure-app';
import { E2E_PREFIX } from './db';

// Environment is read once, when AppModule is imported (see setup/env.ts).
export async function createTestApp(): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
  configureApp(app);
  await app.init();
  return app;
}

/** Short unique suffix so parallel/previous runs never collide. */
export const uniqueSubdomain = (label: string) =>
  `${E2E_PREFIX}${label}-${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 36).toString(36)}`;

export const PLATFORM_HOST = 'localhost';
export const hostOf = (subdomain: string) => `${subdomain}.localhost`;

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';

export interface CallOptions {
  host?: string;
  token?: string;
  company?: string;
  body?: object;
  headers?: Record<string, string>;
}

/** Thin supertest wrapper: Host header selects the tenant, as in production. */
export class Api {
  constructor(private readonly app: NestExpressApplication) {}

  call(method: Method, path: string, opts: CallOptions = {}) {
    let req = request(this.app.getHttpServer())
      [method](path)
      .set('Host', opts.host ?? PLATFORM_HOST);
    if (opts.token) req = req.set('Authorization', `Bearer ${opts.token}`);
    if (opts.company) req = req.set('X-Company-Id', opts.company);
    for (const [k, v] of Object.entries(opts.headers ?? {})) req = req.set(k, v);
    return opts.body ? req.send(opts.body) : req;
  }

  async platformToken(): Promise<string> {
    const res = await this.call('post', '/platform/api/v1/auth/login', {
      body: { email: process.env.PLATFORM_ADMIN_EMAIL, password: process.env.PLATFORM_ADMIN_PASSWORD },
    });
    if (res.status !== 200) throw new Error(`platform login failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.accessToken;
  }

  async createTenant(platformToken: string, subdomain: string, opts: { plan?: string; adminPassword?: string } = {}) {
    const res = await this.call('post', '/platform/api/v1/tenants', {
      token: platformToken,
      body: {
        name: `Tenant ${subdomain}`,
        subdomain,
        planCode: opts.plan ?? 'business',
        companyLegalName: `${subdomain.toUpperCase()} SAS`,
        adminEmail: `admin@${subdomain}.test`,
        adminFullName: 'Tenant Admin',
        adminPassword: opts.adminPassword ?? ADMIN_PASSWORD,
      },
    });
    if (res.status !== 201) throw new Error(`createTenant failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body as { id: string; subdomain: string; status: string; schemaVersion: string };
  }

  async login(subdomain: string, email: string, password: string): Promise<string> {
    const res = await this.call('post', '/api/v1/auth/login', { host: hostOf(subdomain), body: { email, password } });
    if (res.status !== 200) throw new Error(`login ${email} failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.accessToken;
  }

  adminLogin(subdomain: string) {
    return this.login(subdomain, `admin@${subdomain}.test`, ADMIN_PASSWORD);
  }
}

export const ADMIN_PASSWORD = 'Admin-Password-2026';
export const USER_PASSWORD = 'User-Password-2026';

export const billingAddress = { type: 'BILLING', line1: '1 rue de la Paix', postalCode: '75002', city: 'Paris' };
