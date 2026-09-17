import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import {
  ForbiddenException,
  Injectable,
  type NestMiddleware,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FRONTEND_PROXY_CLIENT_IP_HEADER,
  FRONTEND_PROXY_SECRET_HEADER,
} from '@roller-bay/shared/frontend-proxy';
import type { NextFunction, Request, Response } from 'express';
import type { Environment } from '../config/environment.js';
import './frontend-proxy.types.js';

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * Authenticates the frontend proxy by shared secret rather than by address:
 * neither hosting platform publishes proxy IPs, and the API's own public URL
 * is reachable directly. Only an authenticated proxy may report the client
 * address.
 */
@Injectable()
export class FrontendProxyMiddleware implements NestMiddleware {
  private readonly expected?: Buffer;

  constructor(config: ConfigService<Environment, true>) {
    const secret = config.get('API_PROXY_SECRET', { infer: true });
    this.expected = secret ? digest(secret) : undefined;
  }

  use(request: Request, _response: Response, next: NextFunction) {
    // Without a secret nothing vouches for the address header; never read it.
    if (!this.expected) return next();
    // Equal-length digests keep timingSafeEqual from throwing and hide the
    // secret's length.
    const presented = digest(request.get(FRONTEND_PROXY_SECRET_HEADER) ?? '');
    if (!timingSafeEqual(presented, this.expected))
      throw new ForbiddenException('Direct API access is not permitted.');
    const clientIp = request.get(FRONTEND_PROXY_CLIENT_IP_HEADER);
    if (clientIp && isIP(clientIp)) request.verifiedClientIp = clientIp;
    next();
  }
}
