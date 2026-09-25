import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

// Allocation errors about the order carry an issue on `workOrderId`, the
// field that named it, so the form can show them beside its order picker.
export const orderNotFound = (cause?: unknown) =>
  new NotFoundException(
    {
      message: 'This work order does not exist. Create it first.',
      issues: [
        {
          code: 'order_not_found',
          path: ['workOrderId'],
          message: 'No such work order.',
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
          path: ['workOrderId'],
          message: 'Already allocated.',
        },
      ],
    },
    { cause },
  );

export const orderAlreadyExists = (cause?: unknown) =>
  new ConflictException(
    {
      message: 'A work order with this number already exists.',
      issues: [
        {
          code: 'order_already_exists',
          path: ['orderNumber'],
          message: 'Already exists.',
        },
      ],
    },
    { cause },
  );

export async function workOrdersOperation<T>(
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
        // A number held by an order that still exists is answered without
        // an error, so this is only two requests adding it at once.
        if (
          cause.code === '23505' &&
          'constraint' in cause &&
          cause.constraint === 'work_orders_order_number_unique'
        )
          throw orderAlreadyExists(error);
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
      'Work order storage is unavailable.',
      { cause: error },
    );
  }
}
