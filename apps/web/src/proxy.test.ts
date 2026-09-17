// @vitest-environment node
import {
  FRONTEND_PROXY_CLIENT_IP_HEADER,
  FRONTEND_PROXY_SECRET_HEADER,
} from '@roller-bay/shared/frontend-proxy';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { config, proxy } from './proxy';

const secret = 'proxy-secret-that-is-at-least-32-characters';
// Next reports the upstream request's headers on the proxy response: the
// override list names every header sent upstream, with one value header each.
const upstream = (response: Response, name: string) =>
  response.headers.get(`x-middleware-request-${name}`);
const upstreamNames = (response: Response) =>
  response.headers.get('x-middleware-override-headers')?.split(',') ?? [];

function incoming(headers: Record<string, string> = {}) {
  return new NextRequest(
    'https://ops.example.com/api/stock-items?color=a%20b&page=2',
    { headers },
  );
}

beforeEach(() => {
  vi.stubEnv('API_ORIGIN', undefined);
  vi.stubEnv('API_PROXY_SECRET', undefined);
  vi.stubEnv('VERCEL', undefined);
});
afterEach(() => vi.unstubAllEnvs());

it('runs only for API requests', () => {
  expect(config.matcher).toBe('/api/:path*');
});

it('leaves direct local development unchanged', () => {
  const response = proxy(incoming());
  expect(response.headers.get('x-middleware-next')).toBe('1');
  expect(response.headers.get('x-middleware-rewrite')).toBeNull();
});

it('forwards the path and query with its own secret and the verified client address', () => {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('API_ORIGIN', ' https://roller-bay-api.onrender.com/ ');
  vi.stubEnv('API_PROXY_SECRET', secret);
  const response = proxy(
    incoming({
      cookie: '__Host-roller_bay.sid=value',
      origin: 'https://ops.example.com',
      'idempotency-key': 'key-1',
      'x-real-ip': '198.51.100.7',
      [FRONTEND_PROXY_SECRET_HEADER]: 'forged',
      [FRONTEND_PROXY_CLIENT_IP_HEADER]: '203.0.113.9',
    }),
  );
  expect(response.headers.get('x-middleware-rewrite')).toBe(
    'https://roller-bay-api.onrender.com/api/stock-items?color=a%20b&page=2',
  );
  expect(upstream(response, FRONTEND_PROXY_SECRET_HEADER)).toBe(secret);
  expect(upstream(response, FRONTEND_PROXY_CLIENT_IP_HEADER)).toBe(
    '198.51.100.7',
  );
  expect(upstreamNames(response)).toEqual(
    expect.arrayContaining(['cookie', 'origin', 'idempotency-key']),
  );
  // Only the upstream request may carry the secret.
  expect(response.headers.get(FRONTEND_PROXY_SECRET_HEADER)).toBeNull();
});

it('drops forged proxy headers it cannot replace', () => {
  vi.stubEnv('API_ORIGIN', 'http://127.0.0.1:3001');
  const response = proxy(
    incoming({
      // Off Vercel the client controls this header.
      'x-real-ip': '203.0.113.9',
      [FRONTEND_PROXY_SECRET_HEADER]: 'forged',
      [FRONTEND_PROXY_CLIENT_IP_HEADER]: '203.0.113.9',
    }),
  );
  expect(response.headers.get('x-middleware-rewrite')).toBe(
    'http://127.0.0.1:3001/api/stock-items?color=a%20b&page=2',
  );
  expect(upstreamNames(response)).not.toContain(FRONTEND_PROXY_SECRET_HEADER);
  expect(upstreamNames(response)).not.toContain(
    FRONTEND_PROXY_CLIENT_IP_HEADER,
  );
});
