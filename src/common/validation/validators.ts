import { applyDecorators } from '@nestjs/common';
import { IsString, MaxLength, MinLength, ValidateBy, ValidationOptions } from 'class-validator';
import { COMMON_PASSWORDS } from './common-passwords';
import { isValidIban, isValidSiret } from './identifiers';

export const PASSWORD_MIN_LENGTH = 12;

export const IsSiret = (options?: ValidationOptions) =>
  ValidateBy(
    {
      name: 'isSiret',
      validator: {
        validate: (v) => typeof v === 'string' && isValidSiret(v),
        defaultMessage: () => '$property must be a valid SIRET (14 digits, Luhn)',
      },
    },
    options,
  );

export const IsIban = (options?: ValidationOptions) =>
  ValidateBy(
    {
      name: 'isIban',
      validator: { validate: (v) => typeof v === 'string' && isValidIban(v), defaultMessage: () => '$property must be a valid IBAN' },
    },
    options,
  );

const NotCommonPassword = () =>
  ValidateBy({
    name: 'notCommonPassword',
    validator: {
      validate: (v) => typeof v === 'string' && !COMMON_PASSWORDS.has(v.toLowerCase()),
      defaultMessage: () => '$property is too common',
    },
  });

/** F02 BR-01: at least 12 characters and not a common password. */
export const IsStrongPassword = () => applyDecorators(IsString(), MinLength(PASSWORD_MIN_LENGTH), MaxLength(200), NotCommonPassword());
