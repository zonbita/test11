import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { TenantStatus } from '../../../../generated/control/enums';

const SETTABLE = [TenantStatus.ACTIVE, TenantStatus.SUSPENDED, TenantStatus.DELETED] as const;

export class UpdateTenantStatusDto {
  @IsIn(SETTABLE)
  status: (typeof SETTABLE)[number];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
