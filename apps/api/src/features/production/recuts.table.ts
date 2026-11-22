import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { Recut } from '@roller-bay/shared/production';
import { allocationRequirements, allocations } from '../allocations/tables.js';
import { workOrders } from '../work-orders/tables.js';

// A request exists before stock is reserved. Its optional allocation owns only
// the replacement blinds and uses the ordinary stock and worksheet lifecycle.
export const recuts = pgTable(
  'production_recuts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workOrderId: uuid('work_order_id')
      .notNull()
      .references(() => workOrders.id),
    requirementId: uuid('requirement_id')
      .notNull()
      .references(() => allocationRequirements.id),
    allocationId: uuid('allocation_id')
      .unique()
      .references(() => allocations.id),
    quantity: integer('quantity').notNull(),
    reason: varchar('reason', { length: 1000 }).notNull(),
    needsAssembly: boolean('needs_assembly').notNull(),
    stage: varchar('stage', { length: 16 })
      .$type<Recut['stage']>()
      .notNull()
      .default('requested'),
    revision: integer('revision').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index('production_recuts_order_stage_idx').on(t.workOrderId, t.stage),
    check(
      'production_recuts_quantity_positive',
      sql`${t.quantity} > 0 AND ${t.revision} > 0`,
    ),
    check(
      'production_recuts_stage_valid',
      sql`(${t.stage} = 'requested' AND ${t.allocationId} IS NULL) OR ${t.stage} = 'withdrawn' OR (${t.stage} IN ('cutting','assembly','checking','accepted') AND ${t.allocationId} IS NOT NULL)`,
    ),
  ],
);
