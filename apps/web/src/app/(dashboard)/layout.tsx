import { Suspense, type ReactNode } from 'react';
import { AuthBoundary } from '@/features/auth/auth-boundary';
import { DashboardShell } from '@/components/layout/dashboard-shell';
import { Loading } from '@/components/ui/feedback';
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<Loading />}>
      <AuthBoundary>
        <DashboardShell>{children}</DashboardShell>
      </AuthBoundary>
    </Suspense>
  );
}
