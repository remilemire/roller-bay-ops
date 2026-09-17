// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.stubEnv('API_ORIGIN', undefined);
  vi.stubEnv('VERCEL', undefined);
  vi.resetModules();
});
afterEach(() => vi.unstubAllEnvs());

it('preserves the API path prefix in the same-origin proxy route', async () => {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('API_ORIGIN', ' https://roller-bay-api.onrender.com/ ');
  const { default: config } = await import('../../next.config');
  expect(await config.rewrites?.()).toEqual([
    {
      source: '/api/:path*',
      destination: 'https://roller-bay-api.onrender.com/api/:path*',
    },
  ]);
});

it('rejects a missing upstream on Vercel', async () => {
  vi.stubEnv('VERCEL', '1');
  await expect(import('../../next.config')).rejects.toThrow('API_ORIGIN');
});

it.each([
  'http://roller-bay-api.onrender.com',
  'http://localhost:3001',
  'https://roller-bay-api.onrender.com/api',
  'https://user:password@roller-bay-api.onrender.com',
  'https://roller-bay-api.onrender.com?upstream=other',
  'https://roller-bay-api.onrender.com#fragment',
])('rejects an unsafe or ambiguous deployed upstream: %s', async (origin) => {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('API_ORIGIN', origin);
  await expect(import('../../next.config')).rejects.toThrow('API_ORIGIN');
});

it('leaves direct local development unchanged', async () => {
  const { default: config } = await import('../../next.config');
  expect(await config.rewrites?.()).toEqual([]);
});

it('allows a loopback upstream for local proxy verification', async () => {
  vi.stubEnv('API_ORIGIN', 'http://127.0.0.1:3001');
  const { default: config } = await import('../../next.config');
  expect(await config.rewrites?.()).toEqual([
    {
      source: '/api/:path*',
      destination: 'http://127.0.0.1:3001/api/:path*',
    },
  ]);
});
