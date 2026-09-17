import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it('uses same-origin API paths without deployment-specific browser configuration', async () => {
  vi.stubEnv('NEXT_PUBLIC_API_URL', undefined);
  vi.resetModules();
  expect((await import('./api')).API_URL).toBe('/api');
});

it('retains the explicit API override for direct hosting and local development', async () => {
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://localhost:3001/api/');
  vi.resetModules();
  expect((await import('./api')).API_URL).toBe('http://localhost:3001/api');
});
