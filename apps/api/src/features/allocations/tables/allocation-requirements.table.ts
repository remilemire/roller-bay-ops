import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { fabricColors } from '../../fabric-catalog/tables.js';
import { allocations } from './allocations.table.js';

// A blind the allocation plans: its fabric, finished width and drop, and how
// many. Each allocation holds its own, replaced with its plan, so a cancelled
// or completed plan keeps the blinds it was made for. A draft's may be
// unfinished; confirmation requires every field (see migration 0037).
export const allocationRequirements = pgTable(
  'allocation_requirements',
  {
    // Supplied by the client, so a plan can reference a blind it just added.
    id: uuid('id').primaryKey(),
    allocationId: uuid('allocation_id')
      .notNull()
      .references(() => allocations.id, { onDelete: 'restrict' }),
    position: integer('position').notNull(),
    fabricColorId: uuid('fabric_color_id').references(() => fabricColors.id, {
      onDelete: 'restrict',
    }),
    widthMm: numeric('width_mm', { precision: 12, scale: 3 }),
    // The finished drop; the plan's drop allowance is added when cutting.
    lengthMm: numeric('length_mm', { precision: 12, scale: 3 }),
    quantity: integer('quantity'),
  },
  (table) => [
    uniqueIndex('allocation_requirements_position_unique').on(
      table.allocationId,
      table.position,
    ),
    index('allocation_requirements_fabric_color_id_idx').on(
      table.fabricColorId,
    ),
    check(
      'allocation_requirements_position_positive',
      sql`${table.position} > 0`,
    ),
    check(
      'allocation_requirements_width_mm_positive',
      sql`${table.widthMm} > 0 AND ${table.widthMm} <> 'NaN'::numeric`,
    ),
    check(
      'allocation_requirements_length_mm_positive',
      sql`${table.lengthMm} > 0 AND ${table.lengthMm} <> 'NaN'::numeric`,
    ),
    check(
      'allocation_requirements_quantity_positive',
      sql`${table.quantity} > 0`,
    ),
  ],
);
