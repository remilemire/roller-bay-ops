'use client';
import { useEffect, useSyncExternalStore } from 'react';
import { useHydrated } from '@/lib/use-hydrated';
import {
  reducedTransparencySnapshot,
  setReducedTransparency,
  subscribeTransparency,
} from '@/lib/transparency';

// Keep other tabs in sync even when Settings is not mounted.
export function TransparencyPreferenceSync() {
  useEffect(() => subscribeTransparency(() => {}), []);
  return null;
}

export function TransparencySetting() {
  const hydrated = useHydrated();
  const reduced = useSyncExternalStore(
    subscribeTransparency,
    reducedTransparencySnapshot,
    () => false,
  );
  return (
    <div className="transparency-setting">
      <div>
        <label htmlFor="reduce-transparency">Reduce transparency</label>
        <p id="transparency-description" className="muted">
          Use solid panels and turn off blur. Saved in this browser.
        </p>
      </div>
      <input
        id="reduce-transparency"
        type="checkbox"
        aria-describedby="transparency-description"
        checked={reduced}
        disabled={!hydrated}
        onChange={(event) => setReducedTransparency(event.target.checked)}
      />
    </div>
  );
}
