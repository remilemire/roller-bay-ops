import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  InvalidStockReceiptError,
  StockReceiptConflictError,
  StockReceiptReferenceNotFoundError,
} from './stock-receipts.errors.js';
import { stockReceiptsQuery } from './stock-receipts.persistence.js';

export async function stockReceiptsOperation<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await stockReceiptsQuery(operation);
  } catch (error) {
    if (error instanceof HttpException) throw error;
    if (error instanceof StockReceiptConflictError)
      throw new ConflictException(error.message, { cause: error });
    if (error instanceof StockReceiptReferenceNotFoundError)
      throw new NotFoundException(error.message, { cause: error });
    if (error instanceof InvalidStockReceiptError)
      throw new BadRequestException(error.message, { cause: error });
    throw new ServiceUnavailableException(
      'Stock-receipt storage is unavailable.',
      { cause: error },
    );
  }
}
