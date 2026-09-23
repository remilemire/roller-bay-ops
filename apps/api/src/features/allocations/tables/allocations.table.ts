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
import { workOrders } from '../../work-orders/work-orders.table.js';
import { users } from '../../users/users.table.js';

export const allocations = pgTable(
  'allocations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    isDraft: boolean('is_draft').default(true).notNull(),
    // Drafts too: a plan assigns an order's blinds, so there is none to make
    // without an order.
    workOrderId: uuid('work_order_id')
      .notNull()
      .references(() => workOrders.id, { onDelete: 'restrict' }),
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
    releasedAt: timestamp('released_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'allocations_confirmation_valid',
      sql`(${table.isDraft} AND ${table.confirmedAt} IS NULL AND ${table.completedAt} IS NULL AND ${table.cancelledAt} IS NULL AND ${table.submittedDraftRevision} IS NULL) OR (NOT ${table.isDraft} AND ${table.confirmedAt} IS NOT NULL)`,
    ),
    // A confirmed plan records the rules it was cut with. One left out would
    // be read back, and replanned with, as today's configuration, which no one
    // could tell from the truth. A missing key is NULL, which a check lets
    // through, hence IS NOT DISTINCT FROM.
    check(
      'allocations_confirmed_rules_recorded',
      sql`${table.isDraft} OR (jsonb_typeof(${table.settings} -> 'edgeTrimMm') IS NOT DISTINCT FROM 'number' AND jsonb_typeof(${table.settings} -> 'minimumRemnantWidthMm') IS NOT DISTINCT FROM 'number' AND jsonb_typeof(${table.settings} -> 'minimumRemnantLengthMm') IS NOT DISTINCT FROM 'number' AND jsonb_typeof(${table.settings} -> 'dropAllowanceMm') IS NOT DISTINCT FROM 'number')`,
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
    index('allocations_work_order_id_idx').on(table.workOrderId),
    // An order has at most one live allocation: confirmed and not cancelled,
    // including once completed, until explicitly released. Drafts may share an order.
    uniqueIndex('allocations_live_work_order_unique')
      .on(table.workOrderId)
      .where(
        sql`NOT ${table.isDraft} AND ${table.cancelledAt} IS NULL AND ${table.releasedAt} IS NULL`,
      ),
    index('allocations_created_by_user_id_idx').on(table.createdByUserId),
    check(
      'allocations_released_completed',
      sql`${table.releasedAt} IS NULL OR ${table.completedAt} IS NOT NULL`,
    ),
    // Non-draft allocations are active until completed or cancelled.
    check(
      'allocations_completion_or_cancellation',
      sql`${table.completedAt} IS NULL OR ${table.cancelledAt} IS NULL`,
    ),
  ],
);
