import { afterEach, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { colorThemeScript, colorThemeStorageKey } from './color-themes';
import { useColorTheme } from './use-color-theme';

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-color-theme');
});

it('bootstraps a saved palette and falls back for an unknown value', () => {
  new Function(colorThemeScript)();
  expect(document.documentElement.dataset.colorTheme).toBe('slate');
  localStorage.setItem(colorThemeStorageKey, 'sage');
  new Function(colorThemeScript)();
  expect(document.documentElement.dataset.colorTheme).toBe('sage');
  localStorage.setItem(colorThemeStorageKey, 'ocean');
  new Function(colorThemeScript)();
  expect(document.documentElement.dataset.colorTheme).toBe('ocean');
  localStorage.setItem(colorThemeStorageKey, 'not-a-theme');
  new Function(colorThemeScript)();
  expect(document.documentElement.dataset.colorTheme).toBe('slate');
});

it('updates all subscribers and persists independently of light/dark mode', () => {
  localStorage.setItem('roller-bay-theme', 'dark');
  const first = renderHook(useColorTheme);
  const second = renderHook(useColorTheme);
  act(() => first.result.current.setColorTheme('plum'));
  expect(second.result.current.colorTheme).toBe('plum');
  expect(localStorage.getItem(colorThemeStorageKey)).toBe('plum');
  expect(localStorage.getItem('roller-bay-theme')).toBe('dark');
});

it('syncs changes and resets from other tabs, ignoring session storage', () => {
  const { result } = renderHook(useColorTheme);
  const storageEvent = (
    value: string | null,
    storageArea = localStorage,
    key: string | null = colorThemeStorageKey,
  ) => {
    act(() =>
      window.dispatchEvent(
        new StorageEvent('storage', { key, newValue: value, storageArea }),
      ),
    );
  };
  storageEvent('sand');
  expect(result.current.colorTheme).toBe('sand');
  storageEvent('ocean', sessionStorage);
  expect(result.current.colorTheme).toBe('sand');
  storageEvent('unknown');
  expect(result.current.colorTheme).toBe('slate');
  storageEvent('ocean');
  storageEvent(null, localStorage, null);
  expect(result.current.colorTheme).toBe('slate');
});

it('remains usable if browser storage is blocked', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  expect(() => new Function(colorThemeScript)()).not.toThrow();
  const { result } = renderHook(useColorTheme);
  act(() => result.current.setColorTheme('slate'));
  expect(result.current.colorTheme).toBe('slate');
});
