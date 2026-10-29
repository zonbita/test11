import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '../../common/errors/error-codes';
import { ControlPrismaService } from '../../database/control-prisma.service';
import { Plan } from '../../generated/control/client';
import { CompanyStatus, UserStatus } from '../../generated/tenant/enums';
import { TenantDbService } from './tenant-db.service';

const CACHE_TTL_MS = 60_000;

type LimitedResource = 'users' | 'companies';

/** F01 BR-04: plan limits checked in the backend before creating limited resources. */
@Injectable()
export class PlanLimitsService {
  private readonly plans = new Map<string, { plan: Plan; expiresAt: number }>();

  constructor(
    private readonly control: ControlPrismaService,
    private readonly tenantDb: TenantDbService,
  ) {}

  /** Throws 402 PLAN_LIMIT_REACHED if creating `adding` more would exceed the tenant's plan. */
  async assertCanAdd(resource: LimitedResource, adding = 1) {
    const plan = await this.plan(this.tenantDb.context.planId);
    const db = this.tenantDb.client;
    const [used, max] =
      resource === 'users'
        ? [await db.user.count({ where: { status: { not: UserStatus.DISABLED } } }), plan.maxUsers]
        : [await db.company.count({ where: { status: CompanyStatus.ACTIVE } }), plan.maxCompanies];
    if (used + adding > max) {
      throw new AppException(
        HttpStatus.PAYMENT_REQUIRED,
        ErrorCode.PLAN_LIMIT_REACHED,
        `Plan "${plan.name}" allows ${max} ${resource}; upgrade the plan to add more`,
      );
    }
  }

  private async plan(planId: string): Promise<Plan> {
    const cached = this.plans.get(planId);
    if (cached && cached.expiresAt > Date.now()) return cached.plan;
    const plan = await this.control.plan.findUniqueOrThrow({ where: { id: planId } });
    this.plans.set(planId, { plan, expiresAt: Date.now() + CACHE_TTL_MS });
    return plan;
  }
}
