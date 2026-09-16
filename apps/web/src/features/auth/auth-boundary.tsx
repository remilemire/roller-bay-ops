'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, SESSION_EXPIRED_EVENT } from '@/lib/api';
import { ErrorNotice, Loading } from '@/components/ui/feedback';
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
  const session = useQuery(sessionQuery());
  const router = useRouter();
  useEffect(() => {
    if (session.data === null) router.replace('/login');
  }, [session.data, router]);
  if (session.isPending || session.data === null) return <Loading />;
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
