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

const nextConfig: NextConfig = {
  agentRules: false,
  transpilePackages: ['@roller-bay/shared'],
  async rewrites() {
    // Keep browser sessions on the frontend origin; the API retains its /api prefix.
    return apiOrigin
      ? [
          {
            source: '/api/:path*',
            destination: `${new URL(apiOrigin).origin}/api/:path*`,
          },
        ]
      : [];
  },
};

export default nextConfig;
