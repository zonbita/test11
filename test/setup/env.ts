// Loaded before every e2e test file (and by global setup): .env (if present) + test overrides.
import 'dotenv/config';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.E2E_LOG_LEVEL ?? 'silent';
process.env.LOG_PRETTY = 'false';
process.env.APP_BASE_DOMAIN = 'localhost';
// Tests log in many times from the same IP; the rate limit itself is covered by throttle.e2e-spec.ts
process.env.THROTTLE_DEFAULT_LIMIT = '100000';
process.env.THROTTLE_LOGIN_LIMIT = '100000';

// A brand-new platform for every run, isolated from the dev data on the same PostgreSQL server:
// its own control DB, and tenant databases named tenant_e2e_<subdomain>.
const url = new URL(process.env.CONTROL_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/compte_control');
url.pathname = '/compte_control_e2e';
process.env.CONTROL_DATABASE_URL = url.toString();
process.env.TENANT_DB_NAME_PREFIX = 'tenant_e2e_';
