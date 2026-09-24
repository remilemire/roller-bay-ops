import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  primaryKey,
  foreignKey,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { Station } from '@roller-bay/shared/users';
import { workOrders } from '../work-orders/tables.js';
import { users } from '../users/tables.js';
import { employees } from '../employees/tables.js';
export const productionCompletions = pgTable(
  'production_completions',
  {
    workOrderId: uuid('work_order_id')
      .notNull()
      .references(() => workOrders.id, { onDelete: 'restrict' }),
    station: varchar('station', { length: 16 }).$type<Station>().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }).notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    recordedByUserId: uuid('recorded_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
  },
  (t) => [
    check(
      'production_completions_station_valid',
      sql`${t.station} IN ('cutting','assembly','checking','shipping')`,
    ),
    primaryKey({ columns: [t.workOrderId, t.station] }),
    index('production_completions_station_time_idx').on(
      t.station,
      t.completedAt,
    ),
  ],
);

// Every employee credited with a milestone; names and initials are copied so
// history survives renames. Explicit constraint names stay under Postgres's
// 63-character limit.
export const productionCompletionEmployees = pgTable(
  'production_completion_employees',
  {
    workOrderId: uuid('work_order_id').notNull(),
    station: varchar('station', { length: 16 }).$type<Station>().notNull(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    employeeName: varchar('employee_name', { length: 120 }).notNull(),
    employeeInitials: varchar('employee_initials', { length: 12 }).notNull(),
  },
  (t) => [
    primaryKey({
      name: 'production_completion_employees_pk',
      columns: [t.workOrderId, t.station, t.employeeId],
    }),
    foreignKey({
      name: 'production_completion_employees_completion_fk',
      columns: [t.workOrderId, t.station],
      foreignColumns: [
        productionCompletions.workOrderId,
        productionCompletions.station,
      ],
    }).onDelete('cascade'),
  ],
);

export type CompletionEmployee = Pick<
  typeof productionCompletionEmployees.$inferSelect,
  'employeeId' | 'employeeName' | 'employeeInitials'
>;
export type CompletionRecord = typeof productionCompletions.$inferSelect & {
  employees: CompletionEmployee[];
};
export type CompletionValues = Omit<
  CompletionRecord,
  'workOrderId' | 'station'
>;
