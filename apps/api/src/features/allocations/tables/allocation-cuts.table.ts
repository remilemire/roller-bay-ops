import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  numeric,
  pgTable,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { allocationItems } from './allocation-items.table.js';

export const allocationCuts = pgTable(
  'allocation_cuts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    allocationItemId: uuid('allocation_item_id')
      .notNull()
      .references(() => allocationItems.id, { onDelete: 'restrict' }),
    // One-based order across the whole plan, including unassigned draft drops.
    planPosition: integer('plan_position').notNull(),
    // One-based drop order within the selected stock item.
    position: integer('position').notNull(),
    // Calculated by the validator from assigned requirements, not a SQL generated column.
    plannedLengthMm: numeric('planned_length_mm', {
      precision: 12,
      scale: 3,
    }),
    // Snapshot of the universal allowance for ONE original outside edge.
    edgeTrimMm: numeric('edge_trim_mm', { precision: 12, scale: 3 }),
  },
  (table) => [
    check(
      'allocation_cuts_plan_position_positive',
      sql`${table.planPosition} > 0`,
    ),
    uniqueIndex('allocation_cuts_item_position_unique').on(
      table.allocationItemId,
      table.position,
    ),
    check('allocation_cuts_position_positive', sql`${table.position} > 0`),
    check(
      'allocation_cuts_planned_length_mm_positive',
      sql`${table.plannedLengthMm} > 0 AND ${table.plannedLengthMm} <> 'NaN'::numeric`,
    ),
    check(
      'allocation_cuts_edge_trim_mm_positive',
      sql`${table.edgeTrimMm} > 0 AND ${table.edgeTrimMm} <> 'NaN'::numeric`,
    ),
  ],
);
