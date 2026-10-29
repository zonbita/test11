import { Type } from 'class-transformer';
import { IsArray, IsEmail, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { IsStrongPassword } from '../../../common/validation/validators';
import { MembershipDto } from './membership.dto';

export class CreateUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MaxLength(200)
  fullName: string;

  // TODO(F04 AC-01): replace with an email invitation (user INVITED until activated)
  @IsStrongPassword()
  password: string;

  @IsOptional()
  @IsIn(['fr', 'en', 'vi'])
  locale?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MembershipDto)
  memberships: MembershipDto[];
}
