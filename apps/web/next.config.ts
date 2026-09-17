import type { NextConfig } from 'next';

const apiOrigin = process.env.API_ORIGIN?.trim();
if (process.env.VERCEL === '1' && !apiOrigin) {
  throw new Error(
    'API_ORIGIN must be set to the Render API HTTPS origin on Vercel.',
  );
}
if (apiOrigin) {
  const url = new URL(apiOrigin);
  const localHttp =
    process.env.VERCEL !== '1' &&
    url.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !localHttp) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error(
      'API_ORIGIN must be an HTTPS origin without a path or credentials.',
    );
  }
}

// src/proxy.ts forwards /api/* and sends this as a header value, so it must be
// printable ASCII without whitespace: padding would be trimmed in transit and
// the API would then reject every request.
const apiProxySecret = process.env.API_PROXY_SECRET;
if (
  apiProxySecret
    ? !/^[\x21-\x7e]{32,}$/.test(apiProxySecret)
    : process.env.VERCEL === '1'
) {
  throw new Error(
    'API_PROXY_SECRET must match the API and be at least 32 printable characters without whitespace.',
  );
}

const nextConfig: NextConfig = {
  agentRules: false,
  transpilePackages: ['@roller-bay/shared'],
};

export default nextConfig;
