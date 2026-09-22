import {
  ConflictException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  CatalogCodeConflictError,
  CatalogInUseError,
  CatalogReferenceNotFoundError,
} from './catalog.errors.js';
import { catalogQuery } from './catalog.persistence.js';
export async function catalogOperation<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await catalogQuery(operation);
  } catch (error) {
    if (error instanceof HttpException) throw error;
    if (
      error instanceof CatalogCodeConflictError ||
      error instanceof CatalogInUseError
    )
      throw new ConflictException(error.message, { cause: error });
    if (error instanceof CatalogReferenceNotFoundError)
      throw new NotFoundException(error.message, { cause: error });
    throw new ServiceUnavailableException('Catalog storage is unavailable.', {
      cause: error,
    });
  }
}
