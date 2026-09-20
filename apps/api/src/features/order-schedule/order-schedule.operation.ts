import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

// Allocation errors about the order carry an issue on `orderNumber` so the
// form can show them beside that field.
export const orderNotScheduled = (cause?: unknown) =>
  new NotFoundException(
    {
      message:
        'This order is not on the schedule. Add it before allocating fabric.',
      issues: [
        {
          code: 'order_not_scheduled',
          path: ['orderNumber'],
          message: 'Not on the order schedule.',
        },
      ],
    },
    { cause },
  );
export const orderAlreadyAllocated = (cause?: unknown) =>
  new ConflictException(
    {
      message: 'This order already has an allocation.',
      issues: [
        {
          code: 'order_already_allocated',
          path: ['orderNumber'],
          message: 'Already allocated.',
        },
      ],
    },
    { cause },
  );

export const orderAlreadyScheduled = (cause?: unknown) =>
  new ConflictException(
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
    { cause },
  );

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
        // A number held by an order still on the schedule is answered without
        // an error, so this is only two requests adding it at once.
        if (
          cause.code === '23505' &&
          'constraint' in cause &&
          cause.constraint === 'scheduled_orders_order_number_unique'
        )
          throw orderAlreadyScheduled(error);
        // The contracts reject these first; the checks are the backstop.
        if (cause.code === '23514')
          throw new BadRequestException(
            'Order values violate storage constraints.',
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
