import { sql } from 'drizzle-orm';
import {
  check,
  index,
  numeric,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { stockItems } from '../stock-items/stock-items.table.js';
import { allocations } from './allocations.table.js';

export const allocationItems = pgTable(
  'allocation_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    allocationId: uuid('allocation_id')
      .notNull()
      .references(() => allocations.id, { onDelete: 'restrict' }),
    stockItemId: uuid('stock_item_id')
      .notNull()
      .references(() => stockItems.id, { onDelete: 'restrict' }),
    // Sum of planned drops for rolls; whole remaining length for remnants.
    // A reservation never changes the measured stock balance.
    reservedLengthMm: numeric('reserved_length_mm', {
      precision: 12,
      scale: 3,
    }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('allocation_items_allocation_stock_item_unique').on(
      table.allocationId,
      table.stockItemId,
    ),
    index('allocation_items_stock_item_id_idx').on(table.stockItemId),
    check(
      'allocation_items_reserved_length_mm_positive',
      sql`${table.reservedLengthMm} > 0 AND ${table.reservedLengthMm} <> 'NaN'::numeric`,
    ),
  ],
);
