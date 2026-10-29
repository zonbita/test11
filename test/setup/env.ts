// Loaded before every e2e test file: .env (if present, e.g. locally) + test overrides.
import 'dotenv/config';

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.E2E_LOG_LEVEL ?? 'silent';
process.env.LOG_PRETTY = 'false';
process.env.APP_BASE_DOMAIN = 'localhost';
// Tests log in many times from the same IP; the rate limit itself is covered by throttle.e2e-spec.ts
process.env.THROTTLE_DEFAULT_LIMIT = '100000';
process.env.THROTTLE_LOGIN_LIMIT = '100000';
process.env.PLATFORM_ADMIN_EMAIL ??= 'admin@platform.local';
process.env.PLATFORM_ADMIN_PASSWORD ??= 'ChangeMe-Platform-2026';
