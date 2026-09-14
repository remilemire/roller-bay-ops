import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@redis/client';
import type { Environment } from '../config/environment.js';

@Injectable()
export class RedisService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RedisService.name);
  private hasConnected = false;
  readonly client: ReturnType<typeof createClient>;

  constructor(config: ConfigService<Environment, true>) {
    this.client = createClient({
      url: config.get('REDIS_URL', { infer: true }),
      disableOfflineQueue: true,
      socket: {
        connectTimeout: 5_000,
        reconnectStrategy: (retries) => {
          // Fail startup if unavailable, but recover from later interruptions.
          if (!this.hasConnected) return false;
          return (
            Math.min(100 * 2 ** Math.min(retries, 5), 3_000) +
            Math.floor(Math.random() * 100)
          );
        },
      },
    });
    this.client.on('error', (error: Error) => {
      this.logger.error('Redis connection failed.', error.stack);
    });
    this.client.on('ready', () => {
      this.hasConnected = true;
      this.logger.log('Redis connection ready.');
    });
  }

  async onModuleInit() {
    try {
      await this.client.connect();
    } catch (error) {
      if (this.client.isOpen) this.client.destroy();
      throw error;
    }
  }

  onApplicationShutdown() {
    // Nest has closed the HTTP server; stop the socket and any reconnect loop.
    if (this.client.isOpen) this.client.destroy();
  }
}
