import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
afterEach(() => {
  cleanup();
  // Files that opt into the node environment have no Web Storage on the
  // Node version in .nvmrc; newer Node versions define it globally.
  globalThis.sessionStorage?.clear();
  vi.unstubAllGlobals();
});
