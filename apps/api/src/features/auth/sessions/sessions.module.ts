import { Module } from '@nestjs/common';
import { RedisModule } from '../../../redis/redis.module.js';
import { SessionsRepository } from './sessions.repository.js';
import { SessionsService } from './sessions.service.js';
import { SessionMiddleware } from './session.middleware.js';

@Module({
  imports: [RedisModule],
  providers: [SessionsRepository, SessionsService, SessionMiddleware],
  exports: [SessionsService, SessionMiddleware],
})
export class SessionsModule {}
