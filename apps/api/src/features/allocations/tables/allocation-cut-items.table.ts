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
import { allocationRequirements } from './allocation-requirements.table.js';

export const allocationCutItems = pgTable(
  'allocation_cut_items',
  {
    allocationCutId: uuid('allocation_cut_id')
      .notNull()
      .references(() => allocationCuts.id, { onDelete: 'restrict' }),
    allocationRequirementId: uuid('allocation_requirement_id')
      .notNull()
      .references(() => allocationRequirements.id, { onDelete: 'restrict' }),
    // One-based left-to-right order; copies of a requirement are adjacent.
    position: integer('position').notNull(),
    quantity: integer('quantity').default(1),
  },
  (table) => [
    primaryKey({
      columns: [table.allocationCutId, table.allocationRequirementId],
    }),
    uniqueIndex('allocation_cut_items_cut_position_unique').on(
      table.allocationCutId,
      table.position,
    ),
    index('allocation_cut_items_requirement_id_idx').on(
      table.allocationRequirementId,
    ),
    check('allocation_cut_items_position_positive', sql`${table.position} > 0`),
    check('allocation_cut_items_quantity_positive', sql`${table.quantity} > 0`),
  ],
);
