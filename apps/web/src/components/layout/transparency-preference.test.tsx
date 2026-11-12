import { afterEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TransparencySetting } from './transparency-preference';
import { transparencyScript, transparencyStorageKey } from '@/lib/transparency';

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-reduce-transparency');
});

it('saves a browser preference without changing the color palette or mode', async () => {
  localStorage.setItem('roller-bay-theme', 'dark');
  localStorage.setItem('roller-bay-color-theme', 'plum');
  render(<TransparencySetting />);
  const setting = screen.getByRole('checkbox', { name: 'Reduce transparency' });
  await userEvent.click(setting);
  expect(setting).toBeChecked();
  expect(document.documentElement.dataset.reduceTransparency).toBe('true');
  expect(localStorage.getItem(transparencyStorageKey)).toBe('true');
  await userEvent.click(setting);
  expect(setting).not.toBeChecked();
  expect(localStorage.getItem(transparencyStorageKey)).toBe('false');
  expect(localStorage.getItem('roller-bay-theme')).toBe('dark');
  expect(localStorage.getItem('roller-bay-color-theme')).toBe('plum');
});

it('restores a saved preference before paint and shows the same checked state', () => {
  localStorage.setItem(transparencyStorageKey, 'true');
  new Function(transparencyScript)();
  expect(document.documentElement.dataset.reduceTransparency).toBe('true');
  render(<TransparencySetting />);
  expect(screen.getByRole('checkbox')).toBeChecked();
});

it('leaves the system in control for missing, invalid, or blocked storage', () => {
  for (const value of [null, 'invalid']) {
    if (value) localStorage.setItem(transparencyStorageKey, value);
    new Function(transparencyScript)();
    expect(
      document.documentElement.hasAttribute('data-reduce-transparency'),
    ).toBe(false);
  }
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  expect(() => new Function(transparencyScript)()).not.toThrow();
  expect(
    document.documentElement.hasAttribute('data-reduce-transparency'),
  ).toBe(false);
});

it('still applies the setting when saving to storage is blocked', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  render(<TransparencySetting />);
  await userEvent.click(screen.getByRole('checkbox'));
  expect(screen.getByRole('checkbox')).toBeChecked();
  expect(document.documentElement.dataset.reduceTransparency).toBe('true');
});
