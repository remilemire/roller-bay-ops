'use client';
import { useEffect, useSyncExternalStore } from 'react';
import { useHydrated } from '@/lib/use-hydrated';
import {
  transparencyPreferenceSnapshot,
  setTransparencyPreference,
  subscribeTransparency,
  type TransparencyPreference,
} from '@/lib/transparency';

// Keep other tabs in sync even when Settings is not mounted.
export function TransparencyPreferenceSync() {
  useEffect(() => subscribeTransparency(() => {}), []);
  return null;
}

export function TransparencySetting() {
  const hydrated = useHydrated();
  const preference = useSyncExternalStore(
    subscribeTransparency,
    transparencyPreferenceSnapshot,
    () => 'system' as const,
  );
  return (
    <div className="transparency-setting">
      <div>
        <label htmlFor="reduce-transparency">Reduce transparency</label>
        <p id="transparency-description" className="muted">
          Use solid panels and turn off blur. System follows your device
          settings.
        </p>
      </div>
      <select
        id="reduce-transparency"
        className="input select"
        aria-describedby="transparency-description"
        value={preference}
        disabled={!hydrated}
        onChange={(event) =>
          setTransparencyPreference(
            event.target.value as TransparencyPreference,
          )
        }
      >
        <option value="system">System</option>
        <option value="on">On</option>
        <option value="off">Off</option>
      </select>
    </div>
  );
}
