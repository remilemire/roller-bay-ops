import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import session from 'express-session';
import type { CookieOptions, Request, Response } from 'express';
import type { Environment } from '../../../config/environment.js';
import { SessionsRepository } from './sessions.repository.js';
import './session.types.js';

@Injectable()
export class SessionsService {
  readonly middleware: ReturnType<typeof session>;
  readonly cookieName: string;
  readonly cookieOptions: CookieOptions;

  constructor(
    private readonly repository: SessionsRepository,
    private readonly config: ConfigService<Environment, true>,
  ) {
    const secure = config.get('NODE_ENV', { infer: true }) === 'production';
    this.cookieName = secure ? '__Host-roller_bay.sid' : 'roller_bay.sid';
    this.cookieOptions = { httpOnly: true, sameSite: 'lax', secure, path: '/' };
    this.middleware = session({
      name: this.cookieName,
      secret: config.get('AUTH_SESSION_SECRET', { infer: true }),
      store: repository.store,
      rolling: false,
      resave: false,
      saveUninitialized: false,
      cookie: this.cookieOptions,
    });
  }

  assertAvailable() {
    if (!this.repository.isAvailable())
      throw new ServiceUnavailableException('Session storage is unavailable.');
  }

  async createAnonymous(request: Request, lifetimeSeconds: number) {
    await this.regenerate(request);
    const expiresAt = Date.now() + lifetimeSeconds * 1000;
    request.session.expiresAt = expiresAt;
    request.session.cookie.expires = new Date(expiresAt);
    await this.save(request);
    return request.sessionID;
  }

  requireActiveId(request: Request) {
    const expiresAt =
      request.session.auth?.expiresAt ?? request.session.expiresAt;
    if (!expiresAt || !Number.isFinite(expiresAt) || expiresAt <= Date.now())
      throw new UnauthorizedException(
        'Invalid or expired browser session. Start again.',
      );
    return request.sessionID;
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
