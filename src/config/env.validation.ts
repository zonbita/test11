import { plainToInstance, Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Min, MinLength, validateSync } from 'class-validator';

// Reads the raw value: implicit conversion would turn the string "false" into true.
const toBool = ({ obj, key }: { obj: Record<string, unknown>; key: string }) => {
  const raw = obj[key];
  return raw === true || raw === 'true' || raw === '1';
};

export class EnvironmentVariables {
  @IsIn(['development', 'production', 'test'])
  NODE_ENV: 'development' | 'production' | 'test' = 'development';

  @IsInt()
  PORT: number = 3000;

  @IsIn(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
  LOG_LEVEL: string = 'info';

  /** Pretty, human-readable logs (development only). */
  @Transform(toBool)
  @IsBoolean()
  LOG_PRETTY: boolean = false;

  /** Express "trust proxy" (hops), needed for correct client IPs behind a load balancer. */
  @IsInt()
  @Min(0)
  TRUST_PROXY: number = 0;

  @IsString()
  @IsNotEmpty()
  APP_BASE_DOMAIN: string;

  /** Extra allowed CORS origins, comma separated. *.APP_BASE_DOMAIN is always allowed. */
  @IsOptional()
  @IsString()
  CORS_ORIGINS?: string;

  @IsString()
  @IsNotEmpty()
  CONTROL_DATABASE_URL: string;

  @IsString()
  @IsNotEmpty()
  TENANT_DB_ADMIN_URL: string;

  /** Address of the "default" tenant database cluster, as seen from this process (differs inside a container). */
  @IsString()
  @IsNotEmpty()
  TENANT_DB_HOST: string;

  @IsInt()
  TENANT_DB_PORT: number = 5432;

  /** Database and role name prefix of tenant databases: <prefix><subdomain>. Lets several environments share a cluster. */
  @Matches(/^[a-z][a-z0-9_]{0,20}$/)
  TENANT_DB_NAME_PREFIX: string = 'tenant_';

  @IsString()
  @MinLength(40)
  DB_CREDENTIALS_KEY: string;

  @IsString()
  @MinLength(32)
  JWT_SECRET: string;

  @IsString()
  JWT_EXPIRES_IN: string = '15m';

  @IsInt()
  @Min(1)
  LOGIN_MAX_ATTEMPTS: number = 5;

  @IsInt()
  @Min(1)
  LOGIN_LOCK_MINUTES: number = 15;

  /** Requests per minute per IP, all routes. */
  @IsInt()
  @Min(1)
  THROTTLE_DEFAULT_LIMIT: number = 120;

  /** Requests per minute per IP on login endpoints. */
  @IsInt()
  @Min(1)
  THROTTLE_LOGIN_LIMIT: number = 10;
}

// Values shipped in .env.example; production must never start with them.
const PLACEHOLDER_MARKERS = ['change-me', 'changeme', 'example'];

function productionErrors(env: EnvironmentVariables): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const errors: string[] = [];
  for (const key of ['JWT_SECRET', 'DB_CREDENTIALS_KEY'] as const) {
    if (PLACEHOLDER_MARKERS.some((m) => env[key].toLowerCase().includes(m))) errors.push(`${key} still has its placeholder value`);
  }
  if (env.LOG_PRETTY) errors.push('LOG_PRETTY must be false in production');
  return errors;
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const env = plainToInstance(EnvironmentVariables, config, { enableImplicitConversion: true });
  const errors = validateSync(env, { skipMissingProperties: false }).flatMap((e) => Object.values(e.constraints ?? {}));
  if (Buffer.from(env.DB_CREDENTIALS_KEY ?? '', 'base64').length !== 32)
    errors.push('DB_CREDENTIALS_KEY must be 32 bytes encoded as base64');
  errors.push(...productionErrors(env));
  if (errors.length > 0) throw new Error(`Invalid environment:\n${errors.map((e) => ` - ${e}`).join('\n')}`);
  return env;
}
