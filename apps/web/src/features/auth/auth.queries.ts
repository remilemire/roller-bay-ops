import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { currentUserSchema } from '@roller-bay/shared/auth';
import { ApiError, api } from '@/lib/api';
import { clearPendingRequests } from '@/lib/pending-request';
export const sessionKey = ['auth', 'me'] as const;
export async function clearPrivateData(client: QueryClient) {
  const privateQueries = {
    predicate: (query: { queryKey: readonly unknown[] }) =>
      query.queryKey[0] !== 'auth',
  };
  await client.cancelQueries(privateQueries);
  client.removeQueries(privateQueries);
  client.getMutationCache().clear();
  clearPendingRequests();
}
export const sessionQuery = () =>
  queryOptions({
    queryKey: sessionKey,
    queryFn: async ({ signal }) => {
      try {
        return await api('/auth/me', currentUserSchema, { signal });
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 15_000,
    refetchOnWindowFocus: 'always',
  });
