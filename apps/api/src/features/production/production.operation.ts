import {
  ConflictException,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';
export async function productionOperation<T>(
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
      if (
        'code' in cause &&
        ['40001', '40P01', '55P03'].includes(String(cause.code))
      )
        throw new ConflictException(
          'Production changed concurrently; refresh and retry.',
          { cause: error },
        );
      cause = 'cause' in cause ? cause.cause : undefined;
    }
    throw new ServiceUnavailableException(
      'Production storage is unavailable.',
      { cause: error },
    );
  }
}
