'use client';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { sessionQuery } from '@/features/auth/auth.queries';
import { applyColorTheme } from '@/lib/color-themes';

/**
 * Applies the signed-in user's palette whenever the session reports one.
 * Signed out, the page keeps whatever the head script painted.
 */
export function AccountColorTheme() {
  const colorTheme = useQuery(sessionQuery()).data?.colorTheme;
  useEffect(() => {
    if (colorTheme) applyColorTheme(colorTheme);
  }, [colorTheme]);
  return null;
}
