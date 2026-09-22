import {
  ConflictException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  LocationInUseError,
  LocationLabelConflictError,
  LocationReferenceNotFoundError,
} from './locations.errors.js';
import { locationsQuery } from './locations.persistence.js';
export async function locationsOperation<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await locationsQuery(operation);
  } catch (error) {
    if (error instanceof HttpException) throw error;
    if (
      error instanceof LocationLabelConflictError ||
      error instanceof LocationInUseError
    )
      throw new ConflictException(error.message, { cause: error });
    if (error instanceof LocationReferenceNotFoundError)
      throw new NotFoundException(error.message, { cause: error });
    throw new ServiceUnavailableException('Location storage is unavailable.', {
      cause: error,
    });
  }
}
