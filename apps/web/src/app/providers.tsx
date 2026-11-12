'use client';
import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { useState, type ReactNode } from 'react';
import { createQueryClient } from '@/lib/query-client';
import { SessionEvents } from '@/features/auth/auth-boundary';
import { AccountColorTheme } from '@/features/users/account-color-theme';
import { TransparencyPreferenceSync } from '@/components/layout/transparency-preference';
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(createQueryClient);
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey="roller-bay-theme"
    >
      <QueryClientProvider client={client}>
        <SessionEvents />
        <AccountColorTheme />
        <TransparencyPreferenceSync />
        {children}
      </QueryClientProvider>
    </ThemeProvider>
  );
}
