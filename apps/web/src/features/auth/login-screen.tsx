'use client';
import { ArrowUpRight, Layers3 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { API_URL } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ErrorNotice } from '@/components/ui/feedback';
import { ThemeSwitch } from '@/components/layout/theme-switch';
import { sessionQuery } from './auth.queries';
export function LoginScreen() {
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
        <h1>
          A clearer view
          <br />
          of every roll.
        </h1>
        <p>
          Your fabric, your floor, your workflow.
          <br />
          All in one thoughtfully connected workspace.
        </p>
        {session.error && <ErrorNotice error={session.error} />}
        <Button asChild className="login-button">
          <a href={`${API_URL}/auth/login`}>
            <span className="microsoft-mark" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
            Continue with Microsoft
            <ArrowUpRight size={18} />
          </a>
        </Button>
        <small>Sign in with your company Microsoft account.</small>
      </section>
      <span className="login-footer">Made for the way you work.</span>
    </main>
  );
}
