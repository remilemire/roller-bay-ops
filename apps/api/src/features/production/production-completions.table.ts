import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  primaryKey,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { Station } from '@roller-bay/shared/users';
import { workOrders } from '../work-orders/work-orders.table.js';
import { users } from '../users/users.table.js';
import { employees } from '../employees/employees.table.js';
export const productionCompletions = pgTable(
  'production_completions',
  {
    workOrderId: uuid('work_order_id')
      .notNull()
      .references(() => workOrders.id, { onDelete: 'restrict' }),
    station: varchar('station', { length: 16 }).$type<Station>().notNull(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    employeeName: varchar('employee_name', { length: 120 }).notNull(),
    employeeInitials: varchar('employee_initials', { length: 12 }).notNull(),
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

export type CompletionRecord = typeof productionCompletions.$inferSelect;
export type CompletionValues = Omit<
  CompletionRecord,
  'workOrderId' | 'station'
>;
