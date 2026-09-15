import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  uuid,
} from 'drizzle-orm/pg-core';
import { fabricColors } from '../fabric-catalog/colors/fabric-colors.table.js';
import { locations } from '../locations/levels/location-levels.table.js';
import { stockReceipts } from './stock-receipts.table.js';

export const stockReceiptItems = pgTable(
  'stock_receipt_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    stockReceiptId: uuid('stock_receipt_id')
      .notNull()
      .references(() => stockReceipts.id, { onDelete: 'restrict' }),
    fabricColorId: uuid('fabric_color_id')
      .notNull()
      .references(() => fabricColors.id, { onDelete: 'restrict' }),
    widthMm: numeric('width_mm', { precision: 12, scale: 3 }).notNull(),
    // Length per roll, not the combined length of the line.
    initialLengthMm: numeric('initial_length_mm', {
      precision: 12,
      scale: 3,
    }).notNull(),
    quantity: integer('quantity').default(1).notNull(),
    // Original receipt location; later stock movements do not change this.
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'restrict' }),
  },
  (table) => [
    index('stock_receipt_items_stock_receipt_id_idx').on(table.stockReceiptId),
    index('stock_receipt_items_fabric_color_id_idx').on(table.fabricColorId),
    index('stock_receipt_items_location_id_idx').on(table.locationId),
    check(
      'stock_receipt_items_width_mm_positive',
      sql`${table.widthMm} > 0 AND ${table.widthMm} <> 'NaN'::numeric`,
    ),
    check(
      'stock_receipt_items_initial_length_mm_positive',
      sql`${table.initialLengthMm} > 0 AND ${table.initialLengthMm} <> 'NaN'::numeric`,
    ),
    check('stock_receipt_items_quantity_positive', sql`${table.quantity} > 0`),
  ],
);
