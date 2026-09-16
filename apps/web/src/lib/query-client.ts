import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (count, error) =>
          count < 2 &&
          (!(error instanceof ApiError) ||
            error.status === 429 ||
            error.status >= 500),
        retryDelay: (attempt, error) =>
          error instanceof ApiError && error.retryAfterMs !== undefined
            ? error.retryAfterMs
            : Math.min(1000 * 2 ** attempt, 10000),
      },
      // Writes need explicit recovery using the same payload and concurrency tokens.
      mutations: { retry: false },
    },
  });
}
