'use client';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { SlidingSelection } from '@/components/ui/sliding-selection';
import { useHydrated } from '@/lib/use-hydrated';
export function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  // The server cannot know the saved theme; defer selection state until hydration.
  const mounted = useHydrated();
  return (
    <SlidingSelection
      className="theme-switch"
      label="Appearance"
      value={mounted ? theme : undefined}
    >
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
    </SlidingSelection>
  );
}
