import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/auth/auth.decorators';
import { ControlDbHealthIndicator } from './control-db.health';

/** Kubernetes/ECS probes. Outside the /api/v1 prefix and tenant resolution. */
@ApiTags('health')
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly controlDb: ControlDbHealthIndicator,
  ) {}

  /** Process is up (no dependency checks). */
  @Get('live')
  @HealthCheck()
  live() {
    return this.health.check([]);
  }

  /** Ready to serve traffic: control plane DB reachable. */
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([() => this.controlDb.check()]);
  }
}
