import {
  colorThemes as colorThemeValues,
  defaultColorTheme,
  type ColorTheme,
} from '@roller-bay/shared/users';

export const colorThemes: { value: ColorTheme; label: string }[] = [
  { value: 'slate', label: 'Slate' },
  { value: 'sage', label: 'Sage' },
  { value: 'ocean', label: 'Ocean' },
  { value: 'sand', label: 'Sand' },
  { value: 'plum', label: 'Plum' },
];

// The account owns the palette. This key only caches the last applied one so
// the head script can paint it before the session loads.
export const colorThemeStorageKey = 'roller-bay-color-theme';

export function applyColorTheme(theme: ColorTheme) {
  document.documentElement.setAttribute('data-color-theme', theme);
  try {
    localStorage.setItem(colorThemeStorageKey, theme);
  } catch {
    // Storage can be blocked; the palette still applies once the session loads.
  }
}

// Runs in the document head before paint; only fixed application constants enter this script.
export const colorThemeScript = `(() => {
  let theme = ${JSON.stringify(defaultColorTheme)};
  try {
    const saved = localStorage.getItem(${JSON.stringify(colorThemeStorageKey)});
    if (${JSON.stringify(colorThemeValues)}.includes(saved)) theme = saved;
  } catch {}
  document.documentElement.setAttribute('data-color-theme', theme);
})();`;
