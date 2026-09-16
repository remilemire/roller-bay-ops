import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn('input', className)} {...props} />;
}
export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn('input select', className)} {...props} />;
}
