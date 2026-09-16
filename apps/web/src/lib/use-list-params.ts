'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
export function useListParams(namespace?: string) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const paramKey = (name: string) =>
    namespace ? `${namespace}-${name}` : name;
  const rawPage = Number(params.get(paramKey('page')) ?? 1);
  const page =
    Number.isInteger(rawPage) && rawPage > 0 && rawPage <= 1_000_000
      ? rawPage
      : 1;
  return {
    page,
    search: params.get(paramKey('search')) ?? '',
    get: (name: string) => params.get(paramKey(name)) ?? '',
    set(values: Record<string, string | number | null>) {
      const next = new URLSearchParams(params);
      if (!('page' in values)) next.delete(paramKey('page'));
      for (const [key, value] of Object.entries(values))
        if (value === null || value === '') next.delete(paramKey(key));
        else next.set(paramKey(key), String(value));
      router.replace(`${pathname}${next.size ? `?${next}` : ''}`, {
        scroll: false,
      });
    },
  };
}
