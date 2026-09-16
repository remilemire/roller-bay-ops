'use client';
import { Check } from 'lucide-react';
import { colorThemes } from '@/lib/color-themes';
import { useColorTheme } from '@/lib/use-color-theme';
import { useHydrated } from '@/lib/use-hydrated';

export function ColorThemePicker() {
  const { colorTheme, setColorTheme } = useColorTheme();
  const hydrated = useHydrated();

  return (
    <fieldset className="color-theme-picker">
      <legend>Color theme</legend>
      <div className="color-theme-grid">
        {colorThemes.map(({ value, label }) => (
          <label className="color-theme-card" key={value}>
            <input
              className="sr-only"
              type="radio"
              name="color-theme"
              value={value}
              checked={colorTheme === value}
              disabled={!hydrated}
              onChange={() => setColorTheme(value)}
            />
            <span
              className="color-theme-preview"
              data-theme-preview={value}
              aria-hidden="true"
            >
              <span className="preview-sidebar">
                <span className="preview-brand" />
                <span className="preview-nav active" />
                <span className="preview-nav" />
                <span className="preview-nav" />
              </span>
              <span className="preview-workspace">
                <span className="preview-heading" />
                <span className="preview-stats">
                  <span />
                  <span />
                  <span />
                </span>
                <span className="preview-table">
                  <span />
                  <span />
                  <span />
                </span>
              </span>
            </span>
            <span className="color-theme-label">
              {label}
              <Check
                className="color-theme-check"
                size={16}
                aria-hidden="true"
              />
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
