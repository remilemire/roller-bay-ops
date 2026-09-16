'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
export function useListParams() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const rawPage = Number(params.get('page') ?? 1);
  const page =
    Number.isInteger(rawPage) && rawPage > 0 && rawPage <= 1_000_000
      ? rawPage
      : 1;
  return {
    page,
    search: params.get('search') ?? '',
    get: (name: string) => params.get(name) ?? '',
    set(values: Record<string, string | number | null>) {
      const next = new URLSearchParams(params);
      if (!('page' in values)) next.delete('page');
      for (const [key, value] of Object.entries(values))
        if (value === null || value === '') next.delete(key);
        else next.set(key, String(value));
      router.replace(`${pathname}${next.size ? `?${next}` : ''}`, {
        scroll: false,
      });
    },
  };
}
