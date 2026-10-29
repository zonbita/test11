import './support/low-login-limit';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Api, createTestApp } from './support/app';

describe('Rate limiting', () => {
  let app: NestExpressApplication;
  let api: Api;

  beforeAll(async () => {
    app = await createTestApp();
    api = new Api(app);
  });
  afterAll(() => app.close());

  it('limits login attempts per IP with 429 RATE_LIMITED; other routes are unaffected', async () => {
    const body = { email: 'nobody@platform.test', password: 'Wrong-Password-1' };
    for (let i = 0; i < 3; i++) expect((await api.call('post', '/platform/api/v1/auth/login', { body })).status).toBe(401);
    const limited = await api.call('post', '/platform/api/v1/auth/login', { body });
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe('RATE_LIMITED');
    expect((await api.call('get', '/health/live')).status).toBe(200);
  });
});
