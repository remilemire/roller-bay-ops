import { sql } from 'drizzle-orm';
import {
  check,
  index,
  uniqueIndex,
  integer,
  numeric,
  pgTable,
  uuid,
} from 'drizzle-orm/pg-core';
import { fabricColors } from '../../fabric-catalog/colors/fabric-colors.table.js';
import { allocations } from './allocations.table.js';

export const allocationRequirements = pgTable(
  'allocation_requirements',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    allocationId: uuid('allocation_id')
      .notNull()
      .references(() => allocations.id, { onDelete: 'restrict' }),
    position: integer('position').notNull(),
    fabricColorId: uuid('fabric_color_id').references(() => fabricColors.id, {
      onDelete: 'restrict',
    }),
    widthMm: numeric('width_mm', { precision: 12, scale: 3 }),
    // Finished drop before the extra allowance.
    lengthMm: numeric('length_mm', { precision: 12, scale: 3 }),
    // Includes bottom bars, tube attachment, and drop straightening.
    lengthAllowanceMm: numeric('length_allowance_mm', {
      precision: 12,
      scale: 3,
    }).default('0'),
    quantity: integer('quantity').default(1),
  },
  (table) => [
    uniqueIndex('allocation_requirements_position_unique').on(
      table.allocationId,
      table.position,
    ),
    check(
      'allocation_requirements_position_positive',
      sql`${table.position} > 0`,
    ),
    index('allocation_requirements_allocation_id_idx').on(table.allocationId),
    index('allocation_requirements_fabric_color_id_idx').on(
      table.fabricColorId,
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
      'allocation_requirements_length_allowance_mm_nonnegative',
      sql`${table.lengthAllowanceMm} >= 0 AND ${table.lengthAllowanceMm} <> 'NaN'::numeric`,
    ),
    check(
      'allocation_requirements_quantity_positive',
      sql`${table.quantity} > 0`,
    ),
  ],
);
