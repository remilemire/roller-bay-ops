'use client';
import { Layers3 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import type { LoginErrorCode } from '@roller-bay/shared/auth';
import { API_URL } from '@/lib/api';
import { useHydrated } from '@/lib/use-hydrated';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/ui/feedback';
import { ThemeSwitch } from '@/components/layout/theme-switch';
import { sessionQuery } from './auth.queries';
const loginErrors: Record<LoginErrorCode, string> = {
  account_not_eligible:
    'This Microsoft account is not eligible to sign in. Choose your company Microsoft account and try again.',
  account_inactive:
    'Your account is deactivated. Contact an administrator to restore access.',
  account_conflict:
    'Your Microsoft profile conflicts with an existing account. Contact an administrator.',
  sign_in_failed:
    'Sign-in could not be completed or has expired. Choose your company Microsoft account and try again.',
  unavailable: 'Sign-in is temporarily unavailable. Please try again shortly.',
};

export function LoginScreen({ loginError }: { loginError?: LoginErrorCode }) {
  const hydrated = useHydrated();
  const session = useQuery(sessionQuery());
  const router = useRouter();
  useEffect(() => {
    if (session.data && !session.error) router.replace('/');
  }, [session.data, session.error, router]);
  return (
    <main className="login-page">
      <div className="login-theme">
        <ThemeSwitch />
      </div>
      <section className="login-panel glass">
        <div className="brand-symbol">
          <Layers3 size={27} />
        </div>
        <div className="eyebrow">ROLLER BAY · OPERATIONS</div>
        <h1>Sign in</h1>
        <p>Use your company Microsoft account.</p>
        {hydrated && session.error && <ErrorNotice error={session.error} />}
        {loginError && (
          <div className="notice notice-error" role="alert">
            {loginErrors[loginError]}
          </div>
        )}
        <Button asChild className="login-button">
          <a href={`${API_URL}/auth/login`}>
            <span className="microsoft-mark" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
            Continue with Microsoft
          </a>
        </Button>
      </section>
    </main>
  );
}
