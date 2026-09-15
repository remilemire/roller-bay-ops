import {
  InvalidStockReceiptError,
  StockReceiptReferenceNotFoundError,
} from './stock-receipts.errors.js';

export async function stockReceiptsQuery<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const seen = new Set<object>();
    let cause: unknown = error;
    while (typeof cause === 'object' && cause !== null && !seen.has(cause)) {
      seen.add(cause);
      if ('code' in cause) {
        if (cause.code === '23503')
          throw new StockReceiptReferenceNotFoundError(
            'A referenced user, fabric color, or location does not exist.',
            { cause: error },
          );
        if (
          cause.code === '22003' ||
          (cause.code === '23514' &&
            'constraint' in cause &&
            typeof cause.constraint === 'string' &&
            cause.constraint.startsWith('stock_receipt'))
        )
          throw new InvalidStockReceiptError(
            'Stock-receipt values are invalid.',
            { cause: error },
          );
      }
      cause = 'cause' in cause ? cause.cause : undefined;
    }
    throw error;
  }
}
