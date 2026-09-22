import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service.js';
import {
  createRepositories,
  type UnitOfWorkContext,
} from './unit-of-work-context.js';

@Injectable()
export class UnitOfWork {
  constructor(private readonly database: DatabaseService) {}
  transaction<T>(
    operation: (context: UnitOfWorkContext) => Promise<T>,
  ): Promise<T> {
    return this.run(operation, false);
  }
  readOnlyTransaction<T>(
    operation: (context: UnitOfWorkContext) => Promise<T>,
  ): Promise<T> {
    return this.run(operation, true);
  }
  private run<T>(
    operation: (context: UnitOfWorkContext) => Promise<T>,
    readOnly: boolean,
  ): Promise<T> {
    return this.database.db.transaction(
      async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
        await tx.execute(sql`SET LOCAL statement_timeout = '30s'`);
        return operation(createRepositories(tx));
      },
      readOnly
        ? { isolationLevel: 'repeatable read', accessMode: 'read only' }
        : { isolationLevel: 'read committed', accessMode: 'read write' },
    );
  }
}
