import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  InvalidStockItemError,
  StockItemInUseError,
  StockItemReferenceNotFoundError,
} from './stock-items.errors.js';
import { stockItemsQuery } from './stock-items.persistence.js';

export async function stockItemsOperation<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await stockItemsQuery(operation);
  } catch (error) {
    if (error instanceof HttpException) throw error;
    if (error instanceof StockItemReferenceNotFoundError)
      throw new NotFoundException(error.message, { cause: error });
    if (error instanceof StockItemInUseError)
      throw new ConflictException(error.message, { cause: error });
    if (error instanceof InvalidStockItemError)
      throw new BadRequestException(error.message, { cause: error });
    throw new ServiceUnavailableException('Stock storage is unavailable.', {
      cause: error,
    });
  }
}
