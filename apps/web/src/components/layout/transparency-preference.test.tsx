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
  const setting = screen.getByRole('combobox', { name: 'Reduce transparency' });
  expect(setting).toHaveValue('system');
  await userEvent.selectOptions(setting, 'on');
  expect(setting).toHaveValue('on');
  expect(document.documentElement.dataset.reduceTransparency).toBe('true');
  expect(localStorage.getItem(transparencyStorageKey)).toBe('true');
  await userEvent.selectOptions(setting, 'off');
  expect(setting).toHaveValue('off');
  expect(localStorage.getItem(transparencyStorageKey)).toBe('false');
  await userEvent.selectOptions(setting, 'system');
  expect(setting).toHaveValue('system');
  expect(localStorage.getItem(transparencyStorageKey)).toBeNull();
  expect(
    document.documentElement.hasAttribute('data-reduce-transparency'),
  ).toBe(false);
  expect(localStorage.getItem('roller-bay-theme')).toBe('dark');
  expect(localStorage.getItem('roller-bay-color-theme')).toBe('plum');
});

it('restores a saved preference before paint and shows the saved choice', () => {
  localStorage.setItem(transparencyStorageKey, 'true');
  new Function(transparencyScript)();
  expect(document.documentElement.dataset.reduceTransparency).toBe('true');
  render(<TransparencySetting />);
  expect(screen.getByRole('combobox')).toHaveValue('on');
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
  await userEvent.selectOptions(screen.getByRole('combobox'), 'on');
  expect(screen.getByRole('combobox')).toHaveValue('on');
  expect(document.documentElement.dataset.reduceTransparency).toBe('true');
});

it('returns to System in this tab even when removing the saved choice is blocked', async () => {
  localStorage.setItem(transparencyStorageKey, 'true');
  new Function(transparencyScript)();
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  render(<TransparencySetting />);
  await userEvent.selectOptions(screen.getByRole('combobox'), 'system');
  expect(screen.getByRole('combobox')).toHaveValue('system');
  expect(
    document.documentElement.hasAttribute('data-reduce-transparency'),
  ).toBe(false);
});
