import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.service.js';
import type { EmployeeInput } from '@roller-bay/shared/employees';
import { employees } from './employees.table.js';
type DB = Pick<
  DatabaseService['db'],
  'select' | 'insert' | 'update' | 'transaction'
>;
@Injectable()
export class EmployeesRepository {
  constructor(
    @Inject(DatabaseService) private readonly connection: { db: DB },
  ) {}
  list(activeOnly = false) {
    return this.connection.db
      .select()
      .from(employees)
      .where(activeOnly ? eq(employees.isActive, true) : undefined)
      .orderBy(asc(employees.name), asc(employees.id));
  }
  async find(id: string, lock = false, tx: DB = this.connection.db) {
    const q = tx.select().from(employees).where(eq(employees.id, id));
    return (await (lock ? q.for('share') : q))[0];
  }
  async create(input: EmployeeInput) {
    return (
      await this.connection.db.insert(employees).values(input).returning()
    )[0]!;
  }
  async update(id: string, input: EmployeeInput) {
    return (
      await this.connection.db
        .update(employees)
        .set({ ...input, revision: sql`${employees.revision}+1` })
        .where(eq(employees.id, id))
        .returning()
    )[0]!;
  }
  transaction<T>(
    fn: (
      repo: EmployeesRepository,
      tx: Parameters<Parameters<DB['transaction']>[0]>[0],
    ) => Promise<T>,
  ) {
    return this.connection.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      return fn(new EmployeesRepository({ db: tx }), tx);
    });
  }
  async lock(id: string) {
    return (
      await this.connection.db
        .select()
        .from(employees)
        .where(eq(employees.id, id))
        .for('no key update')
    )[0];
  }
}
