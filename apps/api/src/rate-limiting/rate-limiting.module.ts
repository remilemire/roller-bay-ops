import {
  Module,
  RequestMethod,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { HEALTH_ROUTES } from '../features/health/index.js';
import { RedisModule } from '../redis/redis.module.js';
import {
  ApiRateLimitMiddleware,
  LoginRateLimitMiddleware,
} from './rate-limiting.middleware.js';
import {
  RATE_LIMIT_KEY_PREFIX,
  RateLimitingService,
} from './rate-limiting.service.js';

@Module({
  imports: [RedisModule],
  providers: [
    RateLimitingService,
    ApiRateLimitMiddleware,
    LoginRateLimitMiddleware,
    { provide: RATE_LIMIT_KEY_PREFIX, useValue: 'roller-bay:rate-limit:' },
  ],
})
export class RateLimitingModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(ApiRateLimitMiddleware)
      .exclude(...HEALTH_ROUTES)
      .forRoutes({ path: '{*path}', method: RequestMethod.ALL });
    consumer
      .apply(LoginRateLimitMiddleware)
      .forRoutes(
        { path: 'auth/login', method: RequestMethod.ALL },
        { path: 'auth/callback', method: RequestMethod.ALL },
      );
  }
}
