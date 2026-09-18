'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { ErrorNotice } from '@/components/ui/feedback';
import { useCurrentUser } from '@/features/auth/auth-boundary';
import { sessionKey } from '@/features/auth/auth.queries';
import { colorThemes } from '@/lib/color-themes';
import { updateColorTheme } from './users.api';

export function ColorThemePicker() {
  const { colorTheme } = useCurrentUser();
  const client = useQueryClient();
  const change = useMutation({
    mutationFn: updateColorTheme,
    // The session's value drives both the radios and the applied palette, so
    // a failed change visibly stays on the saved one.
    onSuccess: (user) => client.setQueryData(sessionKey, user),
  });

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
              // Disabling the radios would drop keyboard focus mid-navigation.
              onChange={() => change.isPending || change.mutate(value)}
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
      {change.error && <ErrorNotice error={change.error} />}
    </fieldset>
  );
}
