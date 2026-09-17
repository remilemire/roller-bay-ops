'use client';
import { useEffect, useRef } from 'react';
/**
 * Saves a value once it has been idle for `delay`. A value whose save failed
 * is not attempted again, so an outage or a rejected value waits for another
 * edit or an explicit save instead of retrying in a loop.
 */
export function useAutosave<T>(
  value: T,
  enabled: boolean,
  save: (value: T) => Promise<unknown>,
  delay = 2000,
) {
  const snapshot = JSON.stringify(value);
  const failed = useRef<string | null>(null);
  const latest = useRef(save);
  useEffect(() => {
    latest.current = save;
  });
  useEffect(() => {
    if (!enabled || failed.current === snapshot) return;
    const timer = setTimeout(() => {
      // Marked before the request so the re-render that follows a failure
      // cannot schedule the same value again.
      failed.current = snapshot;
      // The parsed copy is detached from later edits to the live form values.
      latest.current(JSON.parse(snapshot) as T).then(
        () => {
          if (failed.current === snapshot) failed.current = null;
        },
        () => {},
      );
    }, delay);
    return () => clearTimeout(timer);
  }, [snapshot, enabled, delay]);
}
