'use client';
import type { ReactNode } from 'react';
import { useCanManage } from '@/features/auth';

export default function Layout({ children }: { children: ReactNode }) {
  return useCanManage() ? (
    children
  ) : (
    <p>Only admins can review cutting results.</p>
  );
}
