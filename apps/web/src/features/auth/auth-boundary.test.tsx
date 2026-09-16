import { expect, it, vi } from 'vitest';
import { type ReactNode, Suspense } from 'react';
import { act } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { user } from '../../../tests/fixtures';
import { ApiError } from '@/lib/api';
import { AuthBoundary } from './auth-boundary';
import { LoginScreen } from './login-screen';
import { sessionKey, sessionQuery } from './auth.queries';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

function queryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, retryOnMount: false } },
  });
}

async function hydrateWithCachedSession(
  children: ReactNode,
  prepare: (client: QueryClient) => Promise<void> | void,
  verify: (container: HTMLElement) => void,
) {
  const serverClient = queryClient();
  const client = queryClient();
  const tree = (queryClient: QueryClient) => (
    <QueryClientProvider client={queryClient}>
      <Suspense>{children}</Suspense>
    </QueryClientProvider>
  );
  const container = document.createElement('div');
  container.innerHTML = renderToString(tree(serverClient));
  document.body.append(container);
  const recoverable = vi.fn();
  let root: Root | undefined;
  try {
    // Model an earlier session observer finishing before this subtree hydrates.
    await prepare(client);
    await act(async () => {
      root = hydrateRoot(container, tree(client), {
        onRecoverableError: recoverable,
      });
    });
    expect(recoverable).not.toHaveBeenCalled();
    verify(container);
  } finally {
    await act(async () => root?.unmount());
    container.remove();
    serverClient.clear();
    client.clear();
  }
}

it('hydrates the loading screen before showing an already cached authenticated workspace', async () => {
  await hydrateWithCachedSession(
    <AuthBoundary>
      <div>Private workspace</div>
    </AuthBoundary>,
    (client) => {
      client.setQueryData(sessionKey, user);
    },
    (container) => expect(container).toHaveTextContent('Private workspace'),
  );
});

async function cacheDeactivatedSession(client: QueryClient) {
  await client
    .fetchQuery({
      ...sessionQuery(),
      queryFn: async () => {
        throw new ApiError(403, 'Your account is deactivated.');
      },
    })
    .catch(() => undefined);
}

it('hydrates consistently when a deactivated session is cached before the dashboard', async () => {
  await hydrateWithCachedSession(
    <AuthBoundary>
      <div>Private workspace</div>
    </AuthBoundary>,
    cacheDeactivatedSession,
    (container) => {
      expect(container).toHaveTextContent('Account unavailable');
      expect(container).not.toHaveTextContent('Private workspace');
    },
  );
});

it('hydrates the login screen before displaying a cached session error', async () => {
  await hydrateWithCachedSession(
    <LoginScreen />,
    cacheDeactivatedSession,
    (container) =>
      expect(container).toHaveTextContent('Your account is deactivated.'),
  );
});
