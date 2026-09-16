import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { rateLimit, type RateLimitRequestHandler } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import type { Environment } from '../config/environment.js';
import { RedisService } from '../redis/redis.service.js';

export const RATE_LIMIT_KEY_PREFIX = Symbol('RATE_LIMIT_KEY_PREFIX');

@Injectable()
export class RateLimitingService implements OnModuleInit {
  private apiLimiter!: RateLimitRequestHandler;
  private loginLimiter!: RateLimitRequestHandler;

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService<Environment, true>,
    @Inject(RATE_LIMIT_KEY_PREFIX) private readonly keyPrefix: string,
  ) {}

  async onModuleInit() {
    // RedisModule initializes its connection before this importing module.
    [this.apiLimiter, this.loginLimiter] = await Promise.all([
      this.createLimiter('api', 'RATE_LIMIT_API_LIMIT'),
      this.createLimiter('login', 'RATE_LIMIT_LOGIN_LIMIT'),
    ]);
  }

  api(request: Request, response: Response, next: NextFunction) {
    this.run(this.apiLimiter, request, response, next);
  }

  login(request: Request, response: Response, next: NextFunction) {
    this.run(this.loginLimiter, request, response, next);
  }

  private async createLimiter(
    name: string,
    limitKey: 'RATE_LIMIT_API_LIMIT' | 'RATE_LIMIT_LOGIN_LIMIT',
  ) {
    const store = new RedisStore({
      prefix: `${this.keyPrefix}${name}:`,
      sendCommand: (...args: string[]) =>
        this.redis.client.sendCommand<string | number | (string | number)[]>(
          args,
        ),
    });
    const limiter = rateLimit({
      windowMs:
        this.config.get('RATE_LIMIT_WINDOW_SECONDS', { infer: true }) * 1000,
      limit: this.config.get(limitKey, { infer: true }),
      identifier: name,
      requestPropertyName: `${name}RateLimit`,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      ipv6Subnet: 56,
      passOnStoreError: false,
      skip: (request) => request.method === 'OPTIONS',
      message: {
        statusCode: 429,
        error: 'Too Many Requests',
        message: 'Too many requests. Try again later.',
      },
      store,
    });
    // Finish loading the adapter's atomic Redis scripts before serving traffic.
    // Initialization failures must fail startup, not leave a broken limiter.
    await Promise.all([store.incrementScriptSha, store.getScriptSha]);
    return limiter;
  }

  private run(
    limiter: RateLimitRequestHandler,
    request: Request,
    response: Response,
    next: NextFunction,
  ) {
    if (request.method === 'OPTIONS') return next();
    if (!this.redis.client.isReady)
      return next(
        new ServiceUnavailableException('Rate limiting is unavailable.'),
      );
    void limiter(request, response, (error?: unknown) => {
      next(
        error
          ? new ServiceUnavailableException('Rate limiting is unavailable.', {
              cause: error,
            })
          : undefined,
      );
    });
  }
}
