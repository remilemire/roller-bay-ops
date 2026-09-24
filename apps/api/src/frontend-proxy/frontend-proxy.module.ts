import {
  Module,
  RequestMethod,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { HEALTH_ROUTES } from '../features/health/index.js';
import { FrontendProxyMiddleware } from './frontend-proxy.middleware.js';

@Module({ providers: [FrontendProxyMiddleware] })
export class FrontendProxyModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(FrontendProxyMiddleware)
      .exclude(...HEALTH_ROUTES)
      .forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
