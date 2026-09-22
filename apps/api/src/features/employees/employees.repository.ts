import type { EmployeeInput } from '@roller-bay/shared/employees';
import { asc, eq, sql } from 'drizzle-orm';
import type { DatabaseExecutor } from '../../database/database-executor.js';
import { employees } from './employees.table.js';
export class EmployeesRepository {
  constructor(private readonly db: DatabaseExecutor) {}
  list(activeOnly = false) {
    return this.db
      .select()
      .from(employees)
      .where(activeOnly ? eq(employees.isActive, true) : undefined)
      .orderBy(asc(employees.name), asc(employees.id));
  }
  async find(id: string, lock = false) {
    const q = this.db.select().from(employees).where(eq(employees.id, id));
    return (await (lock ? q.for('share') : q))[0];
  }
  async create(input: EmployeeInput) {
    return (await this.db.insert(employees).values(input).returning())[0]!;
  }
  async update(id: string, input: EmployeeInput) {
    return (
      await this.db
        .update(employees)
        .set({ ...input, revision: sql`${employees.revision}+1` })
        .where(eq(employees.id, id))
        .returning()
    )[0]!;
  }
  async lock(id: string) {
    return (
      await this.db
        .select()
        .from(employees)
        .where(eq(employees.id, id))
        .for('no key update')
    )[0];
  }
}
