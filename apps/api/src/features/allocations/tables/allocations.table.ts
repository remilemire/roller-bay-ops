import type { StockEffect } from '@roller-bay/shared/stock-items';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  uniqueIndex,
  pgTable,
  boolean,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type {
  AllocationCompletion,
  AllocationDraftData,
} from '@roller-bay/shared/allocations';
import type { CuttingPlanSummary } from '../cutting-plan/cutting-plan.types.js';
import { scheduledOrders } from '../../order-schedule/order-schedule.table.js';
import { users } from '../../users/users.table.js';

export const allocations = pgTable(
  'allocations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    isDraft: boolean('is_draft').default(true).notNull(),
    // Drafts may name no order yet; any order named must be scheduled.
    orderNumber: varchar('order_number', { length: 6 }).references(
      () => scheduledOrders.orderNumber,
      { onDelete: 'restrict' },
    ),
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
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    submittedDraftRevision: integer('submitted_draft_revision'),
    stockEffects: jsonb('stock_effects').$type<StockEffect[]>(),
    revision: integer('revision').default(1).notNull(),
    settings: jsonb('settings').$type<AllocationDraftData['settings']>(),
    plannedSummary: jsonb('planned_summary').$type<CuttingPlanSummary>(),
    idempotencyKey: uuid('idempotency_key'),
    requestHash: varchar('request_hash', { length: 64 }),
    completionKey: uuid('completion_key'),
    completionRequestHash: varchar('completion_request_hash', { length: 64 }),
    completion: jsonb('completion').$type<AllocationCompletion>(),
    effectiveCompletion: jsonb(
      'effective_completion',
    ).$type<AllocationCompletion>(),
    correctedAt: timestamp('corrected_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'allocations_confirmation_valid',
      sql`(${table.isDraft} AND ${table.confirmedAt} IS NULL AND ${table.completedAt} IS NULL AND ${table.cancelledAt} IS NULL AND ${table.submittedDraftRevision} IS NULL) OR (NOT ${table.isDraft} AND ${table.confirmedAt} IS NOT NULL AND ${table.orderNumber} IS NOT NULL)`,
    ),
    check(
      'allocations_submitted_revision_valid',
      sql`${table.submittedDraftRevision} IS NULL OR (${table.submittedDraftRevision} > 0 AND ${table.submittedDraftRevision} < ${table.revision})`,
    ),

    uniqueIndex('allocations_creator_idempotency_unique').on(
      table.createdByUserId,
      table.idempotencyKey,
    ),
    check('allocations_revision_positive', sql`${table.revision} > 0`),
    index('allocations_order_number_idx').on(table.orderNumber),
    // An order has at most one live allocation: confirmed and not cancelled,
    // including once completed. Drafts may share an order number.
    uniqueIndex('allocations_live_order_number_unique')
      .on(table.orderNumber)
      .where(sql`NOT ${table.isDraft} AND ${table.cancelledAt} IS NULL`),
    index('allocations_created_by_user_id_idx').on(table.createdByUserId),
    // Non-draft allocations are active until completed or cancelled.
    check(
      'allocations_completion_or_cancellation',
      sql`${table.completedAt} IS NULL OR ${table.cancelledAt} IS NULL`,
    ),
  ],
);
