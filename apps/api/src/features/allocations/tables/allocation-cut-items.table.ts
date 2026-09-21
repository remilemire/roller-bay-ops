import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { allocationCuts } from './allocation-cuts.table.js';
import { workOrderLines } from '../../work-orders/work-order-lines.table.js';

export const allocationCutItems = pgTable(
  'allocation_cut_items',
  {
    allocationCutId: uuid('allocation_cut_id')
      .notNull()
      .references(() => allocationCuts.id, { onDelete: 'restrict' }),
    // The blind being cut: a line of the allocation's work order. A cancelled
    // plan or a draft may point at a line since retired (`retired_at`), which
    // is off the order but kept, so the plan still shows what it was made for.
    // A live or completed plan never does: its order's blinds are frozen.
    workOrderLineId: uuid('work_order_line_id')
      .notNull()
      .references(() => workOrderLines.id, { onDelete: 'restrict' }),
    // One-based left-to-right order; copies of a blind are adjacent.
    position: integer('position').notNull(),
    quantity: integer('quantity').default(1),
  },
  (table) => [
    primaryKey({
      columns: [table.allocationCutId, table.workOrderLineId],
    }),
    uniqueIndex('allocation_cut_items_cut_position_unique').on(
      table.allocationCutId,
      table.position,
    ),
    index('allocation_cut_items_work_order_line_id_idx').on(
      table.workOrderLineId,
    ),
    check('allocation_cut_items_position_positive', sql`${table.position} > 0`),
    check('allocation_cut_items_quantity_positive', sql`${table.quantity} > 0`),
  ],
);
