'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, SESSION_EXPIRED_EVENT } from '@/lib/api';
import { ErrorNotice, Loading } from '@/components/ui/feedback';
import { useHydrated } from '@/lib/use-hydrated';
import { clearPrivateData, sessionKey, sessionQuery } from './auth.queries';
export function SessionEvents() {
  const client = useQueryClient();
  const session = useQuery(sessionQuery());
  const unavailable =
    session.data === null ||
    (session.error instanceof ApiError && session.error.status === 403);
  useEffect(() => {
    if (unavailable) void clearPrivateData(client);
  }, [unavailable, client]);
  useEffect(() => {
    const expired = () => {
      // An in-flight session response must not restore the user after expiry.
      void client.cancelQueries({ queryKey: sessionKey }).then(() => {
        client.setQueryData(sessionKey, null);
        return clearPrivateData(client);
      });
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
  }, [client]);
  return null;
}
export function AuthBoundary({ children }: { children: ReactNode }) {
  const hydrated = useHydrated();
  const session = useQuery(sessionQuery());
  const router = useRouter();
  useEffect(() => {
    if (session.data === null) router.replace('/login');
  }, [session.data, router]);
  // SessionEvents may fill the cache before this Suspense subtree hydrates.
  // Match the server's loading screen until hydration has finished.
  if (!hydrated || session.isPending || session.data === null)
    return <Loading />;
  // Keep mounted forms through transient refetch failures when a session is
  // already known; explicit loss of access still closes the workspace.
  if (
    session.error &&
    (!session.data ||
      (session.error instanceof ApiError && session.error.status === 403))
  )
    return (
      <main className="auth-error">
        <h1>
          {session.error instanceof ApiError && session.error.status === 403
            ? 'Account unavailable'
            : 'Cannot reach your workspace'}
        </h1>
        <ErrorNotice
          error={session.error}
          retry={() => void session.refetch()}
        />
      </main>
    );
  return children;
}
export function useCurrentUser() {
  const query = useQuery(sessionQuery());
  if (!query.data)
    throw new Error(
      'Current user is only available inside the authenticated workspace.',
    );
  return query.data;
}
export function useCanManage() {
  return ['admin', 'owner'].includes(useCurrentUser().role);
}
