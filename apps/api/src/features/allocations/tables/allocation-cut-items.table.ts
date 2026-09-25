import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
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
    // The blind being cut: one of the allocation's own requirements.
    requirementId: uuid('allocation_requirement_id').notNull(),
    // One-based left-to-right order; copies of a blind are adjacent.
    position: integer('position').notNull(),
    quantity: integer('quantity').default(1),
  },
  (table) => [
    // Named: the generated names pass PostgreSQL's 63 characters.
    primaryKey({
      name: 'allocation_cut_items_cut_requirement_pk',
      columns: [table.allocationCutId, table.requirementId],
    }),
    foreignKey({
      name: 'allocation_cut_items_requirement_fk',
      columns: [table.requirementId],
      foreignColumns: [allocationRequirements.id],
    }).onDelete('restrict'),
    uniqueIndex('allocation_cut_items_cut_position_unique').on(
      table.allocationCutId,
      table.position,
    ),
    index('allocation_cut_items_requirement_id_idx').on(table.requirementId),
    check('allocation_cut_items_position_positive', sql`${table.position} > 0`),
    check('allocation_cut_items_quantity_positive', sql`${table.quantity} > 0`),
  ],
);
