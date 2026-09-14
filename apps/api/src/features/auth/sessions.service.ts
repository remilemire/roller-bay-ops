import { createHash } from 'node:crypto';
import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisStore } from 'connect-redis';
import session from 'express-session';
import type { CookieOptions, Request, Response } from 'express';
import { z } from 'zod';
import type { Environment } from '../../config/environment.js';
import { RedisService } from '../../redis/redis.service.js';
import './session.types.js';

const OAUTH_TTL_SECONDS = 600;
export const SESSION_PREFIX = 'roller-bay:session:';
const transactionSchema = z.object({
  state: z.string(),
  nonce: z.string(),
  verifier: z.string(),
  expiresAt: z.number(),
});
export type OAuthTransaction = z.infer<typeof transactionSchema>;

export function sessionTtl(value: session.SessionData) {
  const expiresAt = value.auth?.expiresAt ?? value.oauthExpiresAt ?? 0;
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
}

@Injectable()
export class SessionsService {
  readonly middleware: ReturnType<typeof session>;
  readonly cookieName: string;
  readonly cookieOptions: CookieOptions;

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService<Environment, true>,
  ) {
    const secure = config.get('NODE_ENV', { infer: true }) === 'production';
    this.cookieName = secure ? '__Host-roller_bay.sid' : 'roller_bay.sid';
    this.cookieOptions = { httpOnly: true, sameSite: 'lax', secure, path: '/' };
    this.middleware = session({
      name: this.cookieName,
      secret: config.get('AUTH_SESSION_SECRET', { infer: true }),
      store: new RedisStore({
        client: redis.client,
        prefix: SESSION_PREFIX,
        disableTouch: true,
        ttl: sessionTtl,
      }),
      rolling: false,
      resave: false,
      saveUninitialized: false,
      cookie: this.cookieOptions,
    });
  }

  assertAvailable() {
    if (!this.redis.client.isReady)
      throw new ServiceUnavailableException('Session storage is unavailable.');
  }

  private transactionKey(request: Request, state: string) {
    const browser = createHash('sha256')
      .update(request.sessionID)
      .digest('hex');
    return `roller-bay:oauth:${browser}:${state}`;
  }

  async begin(
    request: Request,
    transaction: Omit<OAuthTransaction, 'expiresAt'>,
  ) {
    await this.regenerate(request);
    const expiresAt = Date.now() + OAUTH_TTL_SECONDS * 1000;
    request.session.oauthExpiresAt = expiresAt;
    request.session.cookie.expires = new Date(expiresAt);
    await this.storage(() =>
      this.redis.client.set(
        this.transactionKey(request, transaction.state),
        JSON.stringify({ ...transaction, expiresAt }),
        { expiration: { type: 'EX', value: OAUTH_TTL_SECONDS } },
      ),
    );
    await this.save(request);
  }

  async consume(request: Request, state: string) {
    if (
      !request.session.oauthExpiresAt ||
      request.session.oauthExpiresAt <= Date.now() ||
      !/^[\w-]{32,128}$/.test(state)
    ) {
      throw new UnauthorizedException(
        'Invalid or expired sign-in. Start again.',
      );
    }
    // Browser binding is part of the key; another browser cannot consume it.
    const raw = await this.storage(() =>
      this.redis.client.getDel(this.transactionKey(request, state)),
    );
    const result = transactionSchema.safeParse(raw ? JSON.parse(raw) : null);
    if (
      !result.success ||
      result.data.expiresAt <= Date.now() ||
      result.data.state !== state
    )
      throw new UnauthorizedException(
        'Invalid or expired sign-in. Start again.',
      );
    return result.data;
  }

  async authenticate(request: Request, userId: string) {
    await this.regenerate(request);
    const authenticatedAt = Date.now();
    const expiresAt =
      authenticatedAt +
      this.config.get('AUTH_SESSION_TTL_SECONDS', { infer: true }) * 1000;
    request.session.auth = { userId, authenticatedAt, expiresAt };
    request.session.cookie.expires = new Date(expiresAt);
    await this.save(request);
  }

  async logout(request: Request, response: Response) {
    await this.storage(
      () =>
        new Promise<void>((resolve, reject) =>
          request.session.destroy((error) =>
            error ? reject(error) : resolve(),
          ),
        ),
    );
    response.clearCookie(this.cookieName, this.cookieOptions);
  }

  private async regenerate(request: Request) {
    await this.storage(
      () =>
        new Promise<void>((resolve, reject) =>
          request.session.regenerate((error) =>
            error ? reject(error) : resolve(),
          ),
        ),
    );
  }

  private async save(request: Request) {
    await this.storage(
      () =>
        new Promise<void>((resolve, reject) =>
          request.session.save((error) => (error ? reject(error) : resolve())),
        ),
    );
  }

  private async storage<T>(operation: () => Promise<T>): Promise<T> {
    this.assertAvailable();
    try {
      return await operation();
    } catch {
      throw new ServiceUnavailableException('Session storage is unavailable.');
    }
  }
}
