'use client';
import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/** False during SSR and hydration; true on later client renders and navigations. */
export function useHydrated() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
