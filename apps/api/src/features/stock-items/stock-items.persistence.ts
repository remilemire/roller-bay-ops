import {
  InvalidStockItemError,
  StockItemInUseError,
  StockItemReferenceNotFoundError,
} from './stock-items.errors.js';

export async function stockItemsQuery<T>(
  operation: () => Promise<T>,
  deleting = false,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    // The service also translates commit failures. Preserve a query's existing
    // classification, especially a foreign-key error from a delete.
    if (
      error instanceof InvalidStockItemError ||
      error instanceof StockItemInUseError ||
      error instanceof StockItemReferenceNotFoundError
    )
      throw error;
    const seen = new Set<object>();
    let cause: unknown = error;
    while (typeof cause === 'object' && cause !== null && !seen.has(cause)) {
      seen.add(cause);
      if ('code' in cause) {
        if (cause.code === '23503') {
          if (deleting)
            throw new StockItemInUseError(
              'This stock item is still referenced.',
              { cause: error },
            );
          throw new StockItemReferenceNotFoundError(
            'The referenced record does not exist.',
            { cause: error },
          );
        }
        if (
          cause.code === '22003' ||
          (cause.code === '23514' &&
            'constraint' in cause &&
            typeof cause.constraint === 'string' &&
            cause.constraint.startsWith('fabric_stock_items_'))
        ) {
          throw new InvalidStockItemError(
            'Stock measurements are inconsistent or exceed the supported range.',
            { cause: error },
          );
        }
      }
      cause = 'cause' in cause ? cause.cause : undefined;
    }
    throw error;
  }
}
