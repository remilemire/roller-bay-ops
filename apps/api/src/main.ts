import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Environment } from './config/environment.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService<Environment, true>);

  app.setGlobalPrefix('api');
  app.set('trust proxy', config.get('TRUSTED_PROXY_IPS', { infer: true }));
  app.enableCors({
    origin: config.get('WEB_ORIGIN', { infer: true }),
    credentials: true,
    exposedHeaders: ['RateLimit', 'RateLimit-Policy', 'Retry-After'],
  });
  app.enableShutdownHooks();
  await app.listen(config.get('PORT', { infer: true }), '127.0.0.1');
}

void bootstrap().catch((error: unknown) => {
  Logger.error(error, undefined, 'Bootstrap');
  process.exitCode = 1;
});
