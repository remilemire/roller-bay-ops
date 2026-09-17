import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/environment.js';
import { DatabaseService } from '../../database/database.service.js';
import { RedisService } from '../../redis/redis.service.js';

@Injectable()
export class HealthService {
  private databaseProbe?: Promise<void>;

  constructor(
    private readonly database: DatabaseService,
    private readonly redis: RedisService,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  async readiness() {
    // Share a pending pool acquisition so polling an exhausted pool cannot queue
    // another connection request on every health check.
    this.databaseProbe ??= this.database.checkConnection().finally(() => {
      this.databaseProbe = undefined;
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all([
          this.databaseProbe,
          this.redis.client.isReady
            ? this.redis.client
                .withAbortSignal(AbortSignal.timeout(1_500))
                .ping()
            : Promise.reject(new Error('Redis disconnected')),
        ]),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Probe timed out')), 2_000);
        }),
      ]);
      return { status: 'ok' as const };
    } catch {
      // Probes are public; never expose connection strings or driver errors.
      throw new ServiceUnavailableException(
        'Application dependencies unavailable.',
      );
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async solver() {
    try {
      if (!this.config.get('SOLVER_API_KEY', { infer: true }))
        throw new Error('Solver not configured');
      const response = await fetch(
        new URL('/health', this.config.get('SOLVER_URL', { infer: true })),
        { signal: AbortSignal.timeout(1_500), redirect: 'error' },
      );
      if (!response.ok) throw new Error('Solver unavailable');
      await response.body?.cancel();
      return { status: 'ok' as const };
    } catch {
      throw new ServiceUnavailableException('Solver unavailable.');
    }
  }
}
