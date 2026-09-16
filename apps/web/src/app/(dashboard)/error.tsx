'use client';
import { ErrorNotice } from '@/components/ui/feedback';
export default function PageError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return <ErrorNotice error={error} retry={reset} />;
}
