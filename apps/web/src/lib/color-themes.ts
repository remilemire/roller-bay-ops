export const colorThemes = [
  { value: 'slate', label: 'Slate' },
  { value: 'sage', label: 'Sage' },
  { value: 'ocean', label: 'Ocean' },
  { value: 'sand', label: 'Sand' },
  { value: 'plum', label: 'Plum' },
] as const;

export type ColorTheme = (typeof colorThemes)[number]['value'];
export const defaultColorTheme: ColorTheme = 'slate';
export const colorThemeStorageKey = 'roller-bay-color-theme';

export function parseColorTheme(value: unknown): ColorTheme {
  return (
    colorThemes.find((theme) => theme.value === value)?.value ??
    defaultColorTheme
  );
}

// Runs in the document head before paint; only fixed application constants enter this script.
export const colorThemeScript = `(() => {
  let theme = ${JSON.stringify(defaultColorTheme)};
  try {
    const saved = localStorage.getItem(${JSON.stringify(colorThemeStorageKey)});
    if (${JSON.stringify(colorThemes.map(({ value }) => value))}.includes(saved)) theme = saved;
  } catch {}
  document.documentElement.setAttribute('data-color-theme', theme);
})();`;
