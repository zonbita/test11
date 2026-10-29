import { IsEmail, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { IsStrongPassword } from '../../../../common/validation/validators';

export class CreateTenantDto {
  @IsString()
  @MaxLength(200)
  name: string;

  /** F01 BR-01: 3–30 chars of a-z, 0-9, "-"; becomes <subdomain>.<APP_BASE_DOMAIN> and database tenant_<subdomain> */
  @Matches(/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/, { message: 'subdomain must be 3-30 chars: a-z, 0-9, -' })
  subdomain: string;

  @IsOptional()
  @IsString()
  planCode?: string;

  @IsString()
  @MaxLength(200)
  companyLegalName: string;

  @IsOptional()
  @Length(2, 2)
  companyCountryCode?: string;

  @IsOptional()
  @Length(3, 3)
  companyCurrency?: string;

  @IsEmail()
  adminEmail: string;

  @IsString()
  @MaxLength(200)
  adminFullName: string;

  // TODO(F01 AC-01): replace with an email invitation once the mailer exists
  @IsStrongPassword()
  adminPassword: string;
}
