'use client';
import { useSyncExternalStore } from 'react';
import {
  colorThemeStorageKey,
  defaultColorTheme,
  parseColorTheme,
  type ColorTheme,
} from './color-themes';

const changeEvent = 'roller-bay-color-theme-change';

function getSnapshot(): ColorTheme {
  return parseColorTheme(
    document.documentElement.getAttribute('data-color-theme'),
  );
}

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== colorThemeStorageKey && event.key !== null) return;
    // Session storage may use the same key; it must not change a browser preference.
    try {
      if (event.storageArea !== window.localStorage) return;
    } catch {
      return;
    }
    document.documentElement.setAttribute(
      'data-color-theme',
      parseColorTheme(event.newValue),
    );
    onChange();
  };
  window.addEventListener(changeEvent, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(changeEvent, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

function setColorTheme(value: ColorTheme) {
  const theme = parseColorTheme(value);
  document.documentElement.setAttribute('data-color-theme', theme);
  try {
    localStorage.setItem(colorThemeStorageKey, theme);
  } catch {
    // Storage can be blocked; keep the selection working for this page anyway.
  }
  window.dispatchEvent(new Event(changeEvent));
}

export function useColorTheme() {
  // The head script owns the initial DOM value; SSR and hydration use a stable fallback.
  const colorTheme = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => defaultColorTheme,
  );
  return { colorTheme, setColorTheme };
}
