'use client';
import { useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { useHydrated } from './use-hydrated';

/**
 * A URL parameter this browser remembers. A value named in the URL wins and is
 * saved; without one, the saved value (or the fallback) is shown and written
 * into the URL, so a link or reload always names what it shows.
 *
 * Returns null until storage can be read, since the server cannot know it, and
 * undefined when there is nothing to show.
 */
export function useRememberedParam<Value extends string>(
  name: string,
  storageKey: string,
  values: readonly Value[],
  fallback?: Value,
) {
  const params = useSearchParams();
  const hydrated = useHydrated();
  const isValue = (value: string | null): value is Value =>
    values.includes(value as Value);
  const named = params.get(name);
  const inUrl = isValue(named);
  const value = inUrl
    ? named
    : hydrated
      ? ((saved) => (isValue(saved) ? saved : fallback))(read(storageKey))
      : null;
  useEffect(() => {
    if (!value) return;
    if (inUrl) write(storageKey, value);
    else {
      // This fills in what is already shown rather than navigating. The
      // history call is synchronous, so several parameters filled in by one
      // render build on each other; router.replace would start each from the
      // same old URL and keep only the last.
      const url = new URL(window.location.href);
      url.searchParams.set(name, value);
      window.history.replaceState(null, '', url);
    }
  }, [inUrl, name, storageKey, value]);
  return {
    value,
    /** Drops the saved value, so a URL without one falls back again. */
    forget: () => write(storageKey, null),
  };
}

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    // Storage can be blocked; the fallback applies.
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Blocked storage only loses the preference.
  }
}
