import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

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
        if (cause.code === '23503')
          throw new NotFoundException(
            'A referenced allocation, fabric, stock item, or location no longer exists.',
          );
        if (cause.code === '23505')
          throw new ConflictException(
            'An allocation identifier or retry key is already in use.',
          );
        if (['23514', '22003'].includes(String(cause.code)))
          throw new BadRequestException(
            'Allocation values violate storage constraints.',
          );
        if (['40001', '40P01', '55P03'].includes(String(cause.code)))
          throw new ConflictException(
            'Stock or allocation changed concurrently; refresh and retry.',
          );
      }
      cause = 'cause' in cause ? cause.cause : undefined;
    }
    throw new ServiceUnavailableException('Allocation storage is unavailable.');
  }
}
