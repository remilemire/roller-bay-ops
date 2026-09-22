import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import type { Environment } from '../config/environment.js';

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool: Pool;
  readonly db: ReturnType<typeof drizzle>;

  constructor(config: ConfigService<Environment, true>) {
    this.pool = new Pool({
      connectionString: config.get('DATABASE_URL', { infer: true }),
      connectionTimeoutMillis: 5_000,
      max: 10,
    });
    this.pool.on('error', (error) => {
      this.logger.error('An idle database connection failed.', error.stack);
    });
    this.db = drizzle(this.pool);
  }

  async onApplicationShutdown() {
    await this.pool.end();
  }

  transaction<T>(
    operation: (tx: DatabaseTransaction) => Promise<T>,
    readOnly = false,
  ) {
    return this.db.transaction(
      async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
        await tx.execute(sql`SET LOCAL statement_timeout = '30s'`);
        return operation(tx);
      },
      readOnly
        ? { isolationLevel: 'repeatable read', accessMode: 'read only' }
        : undefined,
    );
  }

  async checkConnection() {
    const probe = { text: 'SELECT 1', query_timeout: 1_500 };
    await this.pool.query(probe);
  }
}

export type DatabaseTransaction = Parameters<
  Parameters<DatabaseService['db']['transaction']>[0]
>[0];
