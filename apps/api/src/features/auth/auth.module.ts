import {
  Module,
  RequestMethod,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { RedisModule } from '../../redis/redis.module.js';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { MicrosoftService } from './microsoft.service.js';
import { SessionMiddleware } from './session.middleware.js';
import { SessionsService } from './sessions.service.js';

@Module({
  imports: [RedisModule, UsersModule],
  controllers: [AuthController],
  providers: [
    MicrosoftService,
    SessionsService,
    SessionMiddleware,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(SessionMiddleware)
      .exclude({ path: 'health', method: RequestMethod.GET })
      .forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
