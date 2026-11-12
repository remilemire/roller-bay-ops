export const transparencyStorageKey = 'roller-bay-reduce-transparency';
const changeEvent = 'roller-bay-transparency-change';
const mediaQuery = '(prefers-reduced-transparency: reduce)';

function applyStoredPreference(value: string | null) {
  if (value === 'true' || value === 'false')
    document.documentElement.setAttribute('data-reduce-transparency', value);
  else document.documentElement.removeAttribute('data-reduce-transparency');
}

export function reducedTransparencySnapshot() {
  const value = document.documentElement.getAttribute(
    'data-reduce-transparency',
  );
  return value === null
    ? (window.matchMedia?.(mediaQuery).matches ?? false)
    : value === 'true';
}

export function setReducedTransparency(reduced: boolean) {
  applyStoredPreference(String(reduced));
  try {
    localStorage.setItem(transparencyStorageKey, String(reduced));
  } catch {
    // The control still works for this tab when browser storage is blocked.
  }
  window.dispatchEvent(new Event(changeEvent));
}

export function subscribeTransparency(listener: () => void) {
  const media = window.matchMedia?.(mediaQuery);
  const storageChanged = (event: StorageEvent) => {
    if (event.key !== transparencyStorageKey && event.key !== null) return;
    applyStoredPreference(event.newValue);
    listener();
  };
  window.addEventListener(changeEvent, listener);
  window.addEventListener('storage', storageChanged);
  media?.addEventListener('change', listener);
  return () => {
    window.removeEventListener(changeEvent, listener);
    window.removeEventListener('storage', storageChanged);
    media?.removeEventListener('change', listener);
  };
}

// Before paint: missing, invalid, or blocked storage leaves the OS preference
// in control through CSS. Only fixed application constants enter this script.
export const transparencyScript = `(() => {
  try {
    const saved = localStorage.getItem(${JSON.stringify(transparencyStorageKey)});
    if (saved === 'true' || saved === 'false')
      document.documentElement.setAttribute('data-reduce-transparency', saved);
  } catch {}
})();`;
