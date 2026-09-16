import { expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { SESSION_EXPIRED_EVENT } from '@/lib/api';
import { clearPrivateData, sessionKey, sessionQuery } from './auth.queries';

it('resolves an unauthenticated session without emitting a cancellation event for its own query', async () => {
  const expired = vi.fn();
  window.addEventListener(SESSION_EXPIRED_EVENT, expired);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response('{}', { status: 401 })),
  );
  const client = new QueryClient();
  await expect(client.fetchQuery(sessionQuery())).resolves.toBeNull();
  expect(expired).not.toHaveBeenCalled();
  window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
  client.clear();
});

it('removes cached private queries, mutation results and pending writes while preserving the session observer', async () => {
  const client = new QueryClient();
  client.setQueryData(sessionKey, null);
  client.setQueryData(['stock-items'], { private: true });
  client
    .getMutationCache()
    .build(client, { mutationKey: ['receipt'], mutationFn: async () => null });
  sessionStorage.setItem('roller-bay:pending:private', 'secret');
  sessionStorage.setItem('unrelated', 'keep');
  await clearPrivateData(client);
  expect(client.getQueryData(sessionKey)).toBeNull();
  expect(client.getQueryData(['stock-items'])).toBeUndefined();
  expect(client.getMutationCache().getAll()).toHaveLength(0);
  expect(sessionStorage.getItem('roller-bay:pending:private')).toBeNull();
  expect(sessionStorage.getItem('unrelated')).toBe('keep');
  client.clear();
});
