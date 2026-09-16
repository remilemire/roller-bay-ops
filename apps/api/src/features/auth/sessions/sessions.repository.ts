import { Injectable } from '@nestjs/common';
import { RedisStore } from 'connect-redis';
import type { SessionData, Store } from 'express-session';
import { RedisService } from '../../../redis/redis.service.js';
import './session.types.js';

export const SESSION_PREFIX = 'roller-bay:session:';

// Derive TTL from the original deadline; persisting a session must not extend it.
function sessionTtl(session: SessionData) {
  const expiresAt = session.auth?.expiresAt ?? session.expiresAt ?? 0;
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
}

@Injectable()
export class SessionsRepository {
  // Express-session already defines the persistence interface. Reuse its
  // adapter rather than duplicating get/set/destroy through another interface.
  readonly store: Store;

  constructor(private readonly redis: RedisService) {
    this.store = new RedisStore({
      client: redis.client,
      prefix: SESSION_PREFIX,
      disableTouch: true,
      ttl: sessionTtl,
    });
  }

  isAvailable() {
    return this.redis.client.isReady;
  }
}
