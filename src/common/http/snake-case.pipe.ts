import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';
import { validationError } from '../errors/app.exception';
import { keysToCamel, nonSnakeKeys } from './case-conversion';

/**
 * First global pipe: request body and query arrive in snake_case and are handed to the
 * DTOs (and ValidationPipe) in camelCase. camelCase keys from the client are rejected (422).
 */
@Injectable()
export class SnakeCaseRequestPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata) {
    if (metadata.type !== 'body' && metadata.type !== 'query') return value;
    const invalid = nonSnakeKeys(value);
    if (invalid.length > 0) {
      throw validationError(invalid.map((field) => ({ field, code: 'snakeCase', message: `${field} must be written in snake_case` })));
    }
    return keysToCamel(value);
  }
}
