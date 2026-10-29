import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import type { EnvironmentVariables } from '../../config/env.validation';
import type { RequestContext } from './request-context';

export const REQUEST_ID_HEADER = 'x-request-id';
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** Never written to logs, wherever they appear in a logged object. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  'password',
  'adminPassword',
  'newPassword',
  'passwordHash',
  'mfaSecret',
  'dbPasswordEnc',
  'connectionString',
  'accessToken',
  '*.password',
  '*.adminPassword',
  '*.newPassword',
  '*.passwordHash',
  '*.mfaSecret',
  '*.dbPasswordEnc',
  '*.connectionString',
  '*.accessToken',
];

type Req = IncomingMessage & RequestContext & { id?: string };

export function buildLoggerOptions(env: Pick<EnvironmentVariables, 'LOG_LEVEL' | 'LOG_PRETTY'>): Params {
  return {
    pinoHttp: {
      level: env.LOG_LEVEL,
      transport: env.LOG_PRETTY ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'SYS:HH:MM:ss.l' } } : undefined,
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      // Accept a well-formed incoming X-Request-Id (from the gateway), otherwise generate one; always echo it back.
      genReqId: (req: IncomingMessage, res: ServerResponse) => {
        const incoming = req.headers[REQUEST_ID_HEADER];
        const id = typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      customProps: (req: IncomingMessage) => {
        const r = req as Req;
        return {
          tenant: r.tenant?.subdomain,
          tenantId: r.tenant?.id,
          userId: r.user?.id,
          companyId: r.access?.companyId ?? undefined,
        };
      },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
      autoLogging: { ignore: (req) => (req.url ?? '').startsWith('/health') },
      serializers: {
        req: (req: { id: string; method: string; url: string; remoteAddress?: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url,
          remoteAddress: req.remoteAddress,
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    },
  };
}
