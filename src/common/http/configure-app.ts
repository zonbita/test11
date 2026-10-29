import { INestApplication, RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import type { EnvironmentVariables } from '../../config/env.validation';
import { createValidationPipe } from '../validation/validation-pipe.factory';

export const API_PREFIX = 'api/v1';

/** Origins allowed by CORS: any https?://*.APP_BASE_DOMAIN[:port] plus CORS_ORIGINS. */
export function corsOriginChecker(baseDomain: string, extra: string[]) {
  const escaped = baseDomain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^https?://([a-z0-9-]+\\.)*${escaped}(:\\d+)?$`, 'i');
  return (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Non-browser clients send no Origin header
    callback(null, !origin || pattern.test(origin) || extra.includes(origin));
  };
}

/**
 * Everything applied to the HTTP app, shared by main.ts and the e2e tests:
 * logger, security headers, CORS, prefix, validation, Swagger.
 */
export function configureApp(app: NestExpressApplication) {
  const config = app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);

  app.useLogger(app.get(Logger));
  app.set('trust proxy', config.get('TRUST_PROXY', { infer: true }));
  app.use(helmet());
  app.enableCors({
    origin: corsOriginChecker(
      config.get('APP_BASE_DOMAIN', { infer: true }),
      (config.get('CORS_ORIGINS', { infer: true }) ?? '')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),
    credentials: true,
    exposedHeaders: ['X-Request-Id'],
  });
  // PRD ch.4: /api/v1 for tenant apps, /platform/api/v1 for Super Admin (declared on its controllers)
  app.setGlobalPrefix(API_PREFIX, {
    exclude: [
      { path: 'health/{*splat}', method: RequestMethod.ALL },
      { path: 'platform/{*splat}', method: RequestMethod.ALL },
    ],
  });
  app.useGlobalPipes(createValidationPipe());
  app.enableShutdownHooks();

  if (config.get('NODE_ENV', { infer: true }) !== 'production') setupSwagger(app);
}

function setupSwagger(app: INestApplication) {
  const document = new DocumentBuilder()
    .setTitle('COMPTE API')
    .setDescription('Tenant API under /api/v1 on <tenant>.<APP_BASE_DOMAIN>; Super Admin API under /platform/api/v1 on the base domain.')
    .setVersion('1')
    .addBearerAuth()
    .addGlobalParameters({
      name: 'X-Company-Id',
      in: 'header',
      required: false,
      description: 'Selected company (pháp nhân); checked against the user memberships',
      schema: { type: 'string', format: 'uuid' },
    })
    .build();
  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, document));
}
