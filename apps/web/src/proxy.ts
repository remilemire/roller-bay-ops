import {
  FRONTEND_PROXY_CLIENT_IP_HEADER,
  FRONTEND_PROXY_SECRET_HEADER,
} from '@roller-bay/shared/frontend-proxy';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Forwards /api/* to the API so browser sessions stay on the frontend origin;
 * the API keeps its /api prefix. next.config.ts validates the environment at
 * build time. The API cannot identify this proxy by address, so the proxy
 * authenticates with a shared secret and reports the client address itself.
 */
export function proxy(request: NextRequest) {
  const apiOrigin = process.env.API_ORIGIN?.trim();
  // Local development and browser tests reach the API without this proxy.
  if (!apiOrigin) return NextResponse.next();

  const headers = new Headers(request.headers);
  // Set or delete both headers: whatever a browser sent under these names is
  // forged. Headers missing from this list are dropped from the upstream
  // request.
  const secret = process.env.API_PROXY_SECRET;
  if (secret) headers.set(FRONTEND_PROXY_SECRET_HEADER, secret);
  else headers.delete(FRONTEND_PROXY_SECRET_HEADER);
  // Vercel overwrites x-real-ip at its edge; elsewhere the client controls it.
  const clientIp =
    process.env.VERCEL === '1' ? request.headers.get('x-real-ip') : null;
  if (clientIp) headers.set(FRONTEND_PROXY_CLIENT_IP_HEADER, clientIp);
  else headers.delete(FRONTEND_PROXY_CLIENT_IP_HEADER);

  const { pathname, search } = request.nextUrl;
  // `request.headers` reaches only the upstream; plain `headers` would be
  // sent to the browser.
  return NextResponse.rewrite(new URL(pathname + search, apiOrigin), {
    request: { headers },
  });
}

// Must stay a static literal; Next reads it at build time.
export const config = { matcher: '/api/:path*' };
