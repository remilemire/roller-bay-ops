import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { RedisService } from '../../../redis/redis.service.js';
import type { OAuthTransaction } from './oauth-transaction.schema.js';

@Injectable()
export class OAuthTransactionsRepository {
  constructor(private readonly redis: RedisService) {}

  async create(browserSessionId: string, transaction: OAuthTransaction) {
    await this.redis.client.set(
      this.key(browserSessionId, transaction.state),
      JSON.stringify(transaction),
      { expiration: { type: 'PXAT', value: transaction.expiresAt } },
    );
  }

  async consume(browserSessionId: string, state: string): Promise<unknown> {
    // Binding is part of the key, so another browser cannot consume it.
    // GETDEL is atomic: only one concurrent callback can obtain the value.
    const raw = await this.redis.client.getDel(
      this.key(browserSessionId, state),
    );
    return raw ? JSON.parse(raw) : null;
  }

  private key(browserSessionId: string, state: string) {
    const browser = createHash('sha256').update(browserSessionId).digest('hex');
    return `roller-bay:oauth:${browser}:${state}`;
  }
}
