'use client';
import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { useState, type ReactNode } from 'react';
import { createQueryClient } from '@/lib/query-client';
import { SessionEvents } from '@/features/auth/auth-boundary';
import { useColorTheme } from '@/lib/use-color-theme';
export function Providers({ children }: { children: ReactNode }) {
  // Keep palette changes from other tabs in sync even when Settings is not mounted.
  useColorTheme();
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
        {children}
      </QueryClientProvider>
    </ThemeProvider>
  );
}
