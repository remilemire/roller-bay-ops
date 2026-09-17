// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const secret = 'proxy-secret-that-is-at-least-32-characters';

beforeEach(() => {
  vi.stubEnv('API_ORIGIN', undefined);
  vi.stubEnv('API_PROXY_SECRET', undefined);
  vi.stubEnv('VERCEL', undefined);
  vi.resetModules();
});
afterEach(() => vi.unstubAllEnvs());

it('accepts a deployed upstream and leaves forwarding to src/proxy.ts', async () => {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('API_ORIGIN', ' https://roller-bay-api.onrender.com/ ');
  vi.stubEnv('API_PROXY_SECRET', secret);
  const { default: config } = await import('../../next.config');
  // A config rewrite would forward /api without the proxy's headers.
  expect(config.rewrites).toBeUndefined();
});

it('rejects a missing upstream on Vercel', async () => {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('API_PROXY_SECRET', secret);
  await expect(import('../../next.config')).rejects.toThrow('API_ORIGIN');
});

it.each([undefined, 'too-short', `${secret}\n`, `with space ${secret}`])(
  'rejects a missing or malformed proxy secret on Vercel: %j',
  async (value) => {
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('API_ORIGIN', 'https://roller-bay-api.onrender.com');
    vi.stubEnv('API_PROXY_SECRET', value);
    await expect(import('../../next.config')).rejects.toThrow(
      'API_PROXY_SECRET',
    );
  },
);

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
  vi.stubEnv('API_PROXY_SECRET', secret);
  await expect(import('../../next.config')).rejects.toThrow('API_ORIGIN');
});

it('requires no deployment settings for direct local development', async () => {
  await expect(import('../../next.config')).resolves.toBeDefined();
});

it('allows a loopback upstream for local proxy verification', async () => {
  vi.stubEnv('API_ORIGIN', 'http://127.0.0.1:3001');
  await expect(import('../../next.config')).resolves.toBeDefined();
});

it('rejects a malformed proxy secret in any environment', async () => {
  vi.stubEnv('API_PROXY_SECRET', 'too-short');
  await expect(import('../../next.config')).rejects.toThrow('API_PROXY_SECRET');
});
