'use client';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useSyncExternalStore } from 'react';
const subscribe = () => () => {};
export function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  return (
    <div className="theme-switch" role="group" aria-label="Appearance">
      {[
        { value: 'light', label: 'Light mode', Icon: Sun },
        { value: 'dark', label: 'Dark mode', Icon: Moon },
        { value: 'system', label: 'System theme', Icon: Monitor },
      ].map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          aria-label={label}
          title={label}
          aria-pressed={mounted && theme === value}
          onClick={() => setTheme(value)}
        >
          <Icon size={17} />
        </button>
      ))}
    </div>
  );
}
