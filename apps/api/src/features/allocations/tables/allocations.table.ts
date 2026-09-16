import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  uniqueIndex,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type {
  AllocationCompletion,
  CuttingContext,
} from '@roller-bay/shared/allocations';
import type { CuttingPlanSummary } from '../cutting-plan/cutting-plan.types.js';
import { users } from '../../users/users.table.js';

export const allocations = pgTable(
  'allocations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderNumber: varchar('order_number', { length: 50 }).notNull(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    revision: integer('revision').default(1).notNull(),
    settings: jsonb('settings').$type<CuttingContext['settings']>(),
    plannedSummary: jsonb('planned_summary').$type<CuttingPlanSummary>(),
    idempotencyKey: uuid('idempotency_key'),
    requestHash: varchar('request_hash', { length: 64 }),
    completionKey: uuid('completion_key'),
    completionRequestHash: varchar('completion_request_hash', { length: 64 }),
    completion: jsonb('completion').$type<AllocationCompletion>(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('allocations_creator_idempotency_unique').on(
      table.createdByUserId,
      table.idempotencyKey,
    ),
    check('allocations_revision_positive', sql`${table.revision} > 0`),
    index('allocations_order_number_idx').on(table.orderNumber),
    index('allocations_created_by_user_id_idx').on(table.createdByUserId),
    check(
      'allocations_order_number_format',
      sql`length(${table.orderNumber}) > 0 AND ${table.orderNumber} !~ '^[[:space:]]|[[:space:]]$'`,
    ),
    // Both null means active; completion and cancellation are mutually exclusive.
    check(
      'allocations_completion_or_cancellation',
      sql`${table.completedAt} IS NULL OR ${table.cancelledAt} IS NULL`,
    ),
  ],
);
