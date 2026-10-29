import { IsStrongPassword } from '../../../../common/validation/validators';

/** Passwords are never stored with the provisioning input, so a retry asks for it again. */
export class RetryProvisioningDto {
  @IsStrongPassword()
  adminPassword: string;
}
