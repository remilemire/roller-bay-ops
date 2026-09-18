import { afterEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { user } from '../../../tests/fixtures';
import { sessionKey } from '@/features/auth/auth.queries';
import { colorThemeScript, colorThemeStorageKey } from '@/lib/color-themes';
import { AccountColorTheme } from './account-color-theme';
import { ColorThemePicker } from './color-theme-picker';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function renderPicker(session: unknown = user) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(sessionKey, session);
  render(
    <QueryClientProvider client={client}>
      <AccountColorTheme />
      {session ? <ColorThemePicker /> : null}
    </QueryClientProvider>,
  );
  return client;
}

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-color-theme');
});

it('saves the palette to the account and applies what the server returns', async () => {
  localStorage.setItem('roller-bay-theme', 'dark');
  const updated = { ...user, colorTheme: 'plum' };
  const fetchMock = vi.fn().mockResolvedValue(json(updated));
  vi.stubGlobal('fetch', fetchMock);
  const client = renderPicker();
  expect(screen.getByRole('radio', { name: 'Slate' })).toBeChecked();
  await userEvent.click(screen.getByRole('radio', { name: 'Plum' }));
  await waitFor(() =>
    expect(screen.getByRole('radio', { name: 'Plum' })).toBeChecked(),
  );
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toMatch(/\/users\/me\/color-theme$/);
  expect(init.method).toBe('PATCH');
  expect(JSON.parse(init.body as string)).toEqual({ colorTheme: 'plum' });
  expect(client.getQueryData(sessionKey)).toEqual(updated);
  expect(document.documentElement.dataset.colorTheme).toBe('plum');
  // The cache for the head script follows; light/dark mode is untouched.
  expect(localStorage.getItem(colorThemeStorageKey)).toBe('plum');
  expect(localStorage.getItem('roller-bay-theme')).toBe('dark');
});

it('keeps the saved palette and reports the error when saving fails', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(json({ message: 'Temporarily unavailable' }, 503)),
  );
  renderPicker();
  await userEvent.click(screen.getByRole('radio', { name: 'Ocean' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Temporarily unavailable',
  );
  expect(screen.getByRole('radio', { name: 'Slate' })).toBeChecked();
  expect(document.documentElement.dataset.colorTheme).toBe('slate');
});

it('the account palette replaces a cached one; signed out keeps the cache', () => {
  localStorage.setItem(colorThemeStorageKey, 'sand');
  new Function(colorThemeScript)();
  renderPicker(null);
  expect(document.documentElement.dataset.colorTheme).toBe('sand');
  renderPicker({ ...user, colorTheme: 'sage' });
  expect(document.documentElement.dataset.colorTheme).toBe('sage');
  expect(localStorage.getItem(colorThemeStorageKey)).toBe('sage');
});

it('the head script falls back for unknown or blocked storage', () => {
  localStorage.setItem(colorThemeStorageKey, 'not-a-theme');
  new Function(colorThemeScript)();
  expect(document.documentElement.dataset.colorTheme).toBe('slate');
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  expect(() => new Function(colorThemeScript)()).not.toThrow();
  renderPicker({ ...user, colorTheme: 'ocean' });
  expect(document.documentElement.dataset.colorTheme).toBe('ocean');
});
