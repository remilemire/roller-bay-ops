'use client';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useHydrated } from '@/lib/use-hydrated';
export function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  // The server cannot know the saved theme; defer selection state until hydration.
  const mounted = useHydrated();
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
