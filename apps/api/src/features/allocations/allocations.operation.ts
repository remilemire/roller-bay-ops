import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { orderAlreadyAllocated, orderNotFound } from '../work-orders/index.js';

export async function allocationOperation<T>(
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
        const constraint = 'constraint' in cause ? cause.constraint : undefined;
        // The foreign key is the race-free check that an order is scheduled.
        if (
          cause.code === '23503' &&
          constraint === 'allocations_work_order_id_work_orders_id_fk'
        )
          throw orderNotFound(error);
        if (
          cause.code === '23505' &&
          constraint === 'allocations_live_work_order_unique'
        )
          throw orderAlreadyAllocated(error);
        // Neither key says which blind; the issue names the list.
        if (
          cause.code === '23503' &&
          constraint ===
            'allocation_requirements_fabric_color_id_fabric_colors_id_fk'
        )
          throw new NotFoundException(
            {
              message: 'A blind names a fabric color that does not exist.',
              issues: [
                {
                  code: 'fabric_color_not_found',
                  path: ['requirements'],
                  message: 'Unknown fabric color.',
                },
              ],
            },
            { cause: error },
          );
        // Blind ids are client-generated and unique across allocations.
        if (
          cause.code === '23505' &&
          constraint === 'allocation_requirements_pkey'
        )
          throw new BadRequestException(
            {
              message: 'A blind uses an ID that another allocation holds.',
              issues: [
                {
                  code: 'requirement_id_in_use',
                  path: ['requirements'],
                  message: 'ID already used.',
                },
              ],
            },
            { cause: error },
          );
        if (cause.code === '23503')
          throw new NotFoundException(
            'A referenced allocation, fabric, stock item, or location no longer exists.',
            { cause: error },
          );
        if (cause.code === '23505')
          throw new ConflictException(
            'An allocation identifier or retry key is already in use.',
            { cause: error },
          );
        if (['23514', '22003'].includes(String(cause.code)))
          throw new BadRequestException(
            'Allocation values violate storage constraints.',
            { cause: error },
          );
        if (['40001', '40P01', '55P03'].includes(String(cause.code)))
          throw new ConflictException(
            'Stock or allocation changed concurrently; refresh and retry.',
            { cause: error },
          );
      }
      cause = 'cause' in cause ? cause.cause : undefined;
    }
    throw new ServiceUnavailableException(
      'Allocation storage is unavailable.',
      { cause: error },
    );
  }
}
