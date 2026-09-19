import {
  ConflictException,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';

export async function orderScheduleOperation<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof HttpException) throw error;
    const seen = new Set<object>();
    let cause: unknown = error;
    while (typeof cause === 'object' && cause !== null && !seen.has(cause)) {
      seen.add(cause);
      if ('code' in cause) {
        if (
          cause.code === '23505' &&
          'constraint' in cause &&
          cause.constraint === 'scheduled_orders_order_number_unique'
        )
          throw new ConflictException(
            {
              message: 'This order is already on the schedule.',
              issues: [
                {
                  code: 'order_already_scheduled',
                  path: ['orderNumber'],
                  message: 'Already scheduled.',
                },
              ],
            },
            { cause: error },
          );
        // Scheduled orders reference nothing, so only a delete can fail here.
        if (cause.code === '23503')
          throw new ConflictException(
            'This order has allocations or drafts and cannot be deleted.',
            { cause: error },
          );
        if (['40001', '40P01', '55P03'].includes(String(cause.code)))
          throw new ConflictException(
            'The order changed concurrently; refresh and retry.',
            { cause: error },
          );
      }
      cause = 'cause' in cause ? cause.cause : undefined;
    }
    throw new ServiceUnavailableException(
      'Order schedule storage is unavailable.',
      { cause: error },
    );
  }
}
