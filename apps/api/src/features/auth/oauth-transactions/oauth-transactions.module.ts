import { Module } from '@nestjs/common';
import { RedisModule } from '../../../redis/redis.module.js';
import { OAuthTransactionsRepository } from './oauth-transactions.repository.js';
import { OAuthTransactionsService } from './oauth-transactions.service.js';

@Module({
  imports: [RedisModule],
  providers: [OAuthTransactionsRepository, OAuthTransactionsService],
  exports: [OAuthTransactionsService],
})
export class OAuthTransactionsModule {}
