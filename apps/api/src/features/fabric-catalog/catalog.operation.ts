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

export async function catalogOperation<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof HttpException) throw error;
    if (
      error instanceof CatalogCodeConflictError ||
      error instanceof CatalogInUseError
    )
      throw new ConflictException(error.message);
    if (error instanceof CatalogReferenceNotFoundError)
      throw new NotFoundException(error.message);
    throw new ServiceUnavailableException('Catalog storage is unavailable.');
  }
}
