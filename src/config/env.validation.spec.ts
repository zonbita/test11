import { validateEnv } from './env.validation';

const base = {
  APP_BASE_DOMAIN: 'app.example.test',
  CONTROL_DATABASE_URL: 'postgresql://u:p@localhost/c',
  TENANT_DB_ADMIN_URL: 'postgresql://u:p@localhost/postgres',
  TENANT_DB_HOST: 'localhost',
  DB_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString('base64'),
  JWT_SECRET: 'a'.repeat(48),
};

describe('validateEnv', () => {
  it('accepts a valid config and converts types', () => {
    const env = validateEnv({ ...base, PORT: '4000', LOG_PRETTY: 'false', TRUST_PROXY: '1' });
    expect(env.PORT).toBe(4000);
    expect(env.LOG_PRETTY).toBe(false);
    expect(env.TRUST_PROXY).toBe(1);
  });

  it('rejects a DB_CREDENTIALS_KEY that is not 32 bytes', () => {
    expect(() => validateEnv({ ...base, DB_CREDENTIALS_KEY: Buffer.alloc(16).toString('base64') + 'xxxxxxxxxxxxxxxxxxxx' })).toThrow(
      /32 bytes/,
    );
  });

  it('refuses to start in production with placeholder secrets', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production', JWT_SECRET: 'change-me-to-a-long-random-string-xxxxxx' })).toThrow(
      /JWT_SECRET still has its placeholder value/,
    );
  });

  it('refuses pretty logs and a bootstrap admin password in production', () => {
    expect(() => validateEnv({ ...base, NODE_ENV: 'production', LOG_PRETTY: 'true', PLATFORM_ADMIN_PASSWORD: 'x' })).toThrow(
      /LOG_PRETTY[\s\S]*PLATFORM_ADMIN_PASSWORD/,
    );
  });

  it('accepts real secrets in production', () => {
    expect(validateEnv({ ...base, NODE_ENV: 'production' }).NODE_ENV).toBe('production');
  });
});
