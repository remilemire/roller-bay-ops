import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { fabricColors } from '../fabric-catalog/tables.js';
import { workOrders } from './work-orders.table.js';

// A blind on a work order. Rows are never changed or deleted: a plan's cuts
// point at the blinds they were made for, so an edited or removed blind is
// retired and a new row takes its place.
export const workOrderLines = pgTable(
  'work_order_lines',
  {
    // Supplied by the client, so a plan can reference a blind it just added.
    id: uuid('id').primaryKey(),
    workOrderId: uuid('work_order_id')
      .notNull()
      .references(() => workOrders.id, { onDelete: 'restrict' }),
    position: integer('position').notNull(),
    fabricColorId: uuid('fabric_color_id')
      .notNull()
      .references(() => fabricColors.id, { onDelete: 'restrict' }),
    widthMm: numeric('width_mm', { precision: 12, scale: 3 }).notNull(),
    lengthMm: numeric('length_mm', { precision: 12, scale: 3 }).notNull(),
    quantity: integer('quantity').notNull(),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
  },
  (table) => [
    // Not unique: reordering swaps positions one row at a time.
    index('work_order_lines_work_order_id_position_idx').on(
      table.workOrderId,
      table.position,
    ),
    index('work_order_lines_fabric_color_id_idx').on(table.fabricColorId),
    check('work_order_lines_position_positive', sql`${table.position} > 0`),
    check('work_order_lines_width_mm_positive', sql`${table.widthMm} > 0`),
    check('work_order_lines_length_mm_positive', sql`${table.lengthMm} > 0`),
    check('work_order_lines_quantity_positive', sql`${table.quantity} > 0`),
  ],
);
