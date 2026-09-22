import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  integer,
  jsonb,
  uniqueIndex,
  serial,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { Worksheet } from '@roller-bay/shared/production';
import { workOrders } from '../../work-orders/work-orders.table.js';
import { allocations } from './allocations.table.js';
import { users } from '../../users/users.table.js';
import { employees } from '../../employees/employees.table.js';
export const cuttingWorksheets = pgTable(
  'cutting_worksheets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sequence: serial('sequence').notNull(),
    abandonedAt: timestamp('abandoned_at', { withTimezone: true }),
    allocationId: uuid('allocation_id')
      .notNull()
      .references(() => allocations.id, { onDelete: 'restrict' }),
    workOrderId: uuid('work_order_id')
      .notNull()
      .references(() => workOrders.id, { onDelete: 'restrict' }),
    orderNumber: varchar('order_number', { length: 6 }).notNull(),
    revision: integer('revision').notNull().default(1),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    employeeName: varchar('employee_name', { length: 120 }).notNull(),
    employeeInitials: varchar('employee_initials', { length: 12 }).notNull(),
    startedByUserId: uuid('started_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    submittedByUserId: uuid('submitted_by_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    snapshot: jsonb('snapshot').$type<Worksheet['snapshot']>().notNull(),
    draft: jsonb('draft').$type<Worksheet['draft']>(),
    results: jsonb('results').$type<Worksheet['results']>(),
    // Each stock observation names its predecessor, so review cannot reverse measurements.
    baselines: jsonb('baselines')
      .$type<
        Record<string, { revision: number; predecessorId: string | null }>
      >()
      .notNull(),
    appliedStockRevisions: jsonb('applied_stock_revisions').$type<
      Record<string, number>
    >(),
  },
  (t) => [
    uniqueIndex('cutting_worksheets_allocation_unique')
      .on(t.allocationId)
      .where(sql`${t.abandonedAt} IS NULL`),
    check('cutting_worksheets_revision_positive', sql`${t.revision}>0`),
    check(
      'cutting_worksheets_review_requires_submission',
      sql`${t.reviewedAt} IS NULL OR ${t.submittedAt} IS NOT NULL`,
    ),
  ],
);
