import {
  Module,
  RequestMethod,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { UsersModule } from '../users/index.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { MicrosoftService } from './microsoft.service.js';
import { LoginRedirectFilter } from './login-redirect.filter.js';
import { SessionMiddleware } from './sessions/session.middleware.js';
import { SessionsModule } from './sessions/sessions.module.js';
import { OAuthTransactionsModule } from './oauth-transactions/oauth-transactions.module.js';

@Module({
  imports: [SessionsModule, OAuthTransactionsModule, UsersModule],
  controllers: [AuthController],
  providers: [
    MicrosoftService,
    LoginRedirectFilter,
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
