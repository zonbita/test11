import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { buildThrottlerOptions } from './common/http/throttle';
import { buildLoggerOptions } from './common/logging/logger.options';
import { EnvironmentVariables, validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';
import { CompaniesModule } from './modules/companies/companies.module';
import { CustomersModule } from './modules/customers/customers.module';
import { HealthModule } from './modules/health/health.module';
import { NumberingModule } from './modules/numbering/numbering.module';
import { PlatformModule } from './modules/platform/platform.module';
import { PermissionGuard } from './modules/rbac/permission.guard';
import { RbacModule } from './modules/rbac/rbac.module';
import { TenancyModule } from './modules/tenancy/tenancy.module';
import { UsersModule } from './modules/users/users.module';

type AppConfig = ConfigService<EnvironmentVariables, true>;

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    // First: its middleware assigns the request id before tenant resolution runs
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: AppConfig) =>
        buildLoggerOptions({ LOG_LEVEL: config.get('LOG_LEVEL', { infer: true }), LOG_PRETTY: config.get('LOG_PRETTY', { infer: true }) }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: AppConfig) =>
        buildThrottlerOptions({
          THROTTLE_DEFAULT_LIMIT: config.get('THROTTLE_DEFAULT_LIMIT', { infer: true }),
          THROTTLE_LOGIN_LIMIT: config.get('THROTTLE_LOGIN_LIMIT', { infer: true }),
        }),
    }),
    DatabaseModule,
    TenancyModule,
    AuthModule,
    RbacModule,
    NumberingModule,
    HealthModule,
    PlatformModule,
    CompaniesModule,
    UsersModule,
    CustomersModule,
  ],
  providers: [
    // Order matters: rate limit, then authenticate, then authorize.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: JwtAuthGuard },
    { provide: APP_GUARD, useExisting: PermissionGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
