import { sql, type SQL } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { fabricColors } from '../fabric-catalog/colors/fabric-colors.table.js';
import { locations } from '../locations/levels/location-levels.table.js';
import { stockReceiptItems } from '../stock-receipts/stock-receipt-items.table.js';

export const stockItems = pgTable(
  'fabric_stock_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    fabricColorId: uuid('fabric_color_id')
      .notNull()
      .references(() => fabricColors.id, { onDelete: 'restrict' }),
    isRemnant: boolean('is_remnant').default(false).notNull(),
    isUsed: boolean('is_used').default(false).notNull(),
    widthMm: numeric('width_mm', { precision: 12, scale: 3 }).notNull(),
    initialLengthMm: numeric('initial_length_mm', {
      precision: 12,
      scale: 3,
    }).notNull(),
    // Current directly measured length, used only for remnants.
    explicitLengthMm: numeric('explicit_length_mm', {
      precision: 12,
      scale: 3,
    }),
    // One-sided depth: (roll outer diameter - tube outer diameter) / 2.
    radialDepthMm: numeric('radial_depth_mm', { precision: 12, scale: 3 }),
    tubeOuterDiameterMm: integer('tube_outer_diameter_mm'),
    // Snapshot for this measurement; catalog edits must not change its result.
    measurementThicknessMm: numeric('measurement_thickness_mm', {
      precision: 10,
      scale: 3,
    }),
    remainingLengthMm: numeric('remaining_length_mm', {
      precision: 12,
      scale: 3,
    })
      .generatedAlwaysAs(
        (): SQL => sql`CASE
          WHEN ${stockItems.consumedAt} IS NOT NULL THEN 0::numeric
          WHEN ${stockItems.isRemnant} THEN ${stockItems.explicitLengthMm}
          WHEN ${stockItems.radialDepthMm} IS NOT NULL THEN
            round(
              pi()::numeric * ${stockItems.radialDepthMm}
              * (${stockItems.tubeOuterDiameterMm}::numeric + ${stockItems.radialDepthMm})
              / nullif(${stockItems.measurementThicknessMm}, 0),
              3
            )
          ELSE ${stockItems.initialLengthMm}
        END`,
      )
      .notNull(),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'restrict' }),
    sourceStockItemId: uuid('source_stock_item_id').references(
      (): AnyPgColumn => stockItems.id,
      { onDelete: 'restrict' },
    ),
    stockReceiptItemId: uuid('stock_receipt_item_id').references(
      () => stockReceiptItems.id,
      { onDelete: 'restrict' },
    ),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index('fabric_stock_items_fabric_color_id_idx').on(table.fabricColorId),
    index('fabric_stock_items_location_id_idx').on(table.locationId),
    index('fabric_stock_items_source_stock_item_id_idx').on(
      table.sourceStockItemId,
    ),
    index('fabric_stock_items_stock_receipt_item_id_idx').on(
      table.stockReceiptItemId,
    ),
    check(
      'fabric_stock_items_width_mm_positive',
      sql`${table.widthMm} > 0 AND ${table.widthMm} <> 'NaN'::numeric`,
    ),
    check(
      'fabric_stock_items_initial_length_mm_positive',
      sql`${table.initialLengthMm} > 0 AND ${table.initialLengthMm} <> 'NaN'::numeric`,
    ),
    check(
      'fabric_stock_items_explicit_length_mm_nonnegative',
      sql`${table.explicitLengthMm} >= 0 AND ${table.explicitLengthMm} <> 'NaN'::numeric`,
    ),
    check(
      'fabric_stock_items_radial_depth_mm_nonnegative',
      sql`${table.radialDepthMm} >= 0 AND ${table.radialDepthMm} <> 'NaN'::numeric`,
    ),
    check(
      'fabric_stock_items_tube_outer_diameter_mm_step',
      sql`${table.tubeOuterDiameterMm} > 0 AND ${table.tubeOuterDiameterMm} % 5 = 0`,
    ),
    check(
      'fabric_stock_items_tube_usage',
      sql`(
        ${table.isRemnant} AND ${table.tubeOuterDiameterMm} IS NULL
      ) OR (
        NOT ${table.isRemnant} AND (
          (NOT ${table.isUsed} AND ${table.tubeOuterDiameterMm} IS NULL)
          OR (${table.isUsed} AND ${table.tubeOuterDiameterMm} IS NOT NULL)
        )
      )`,
    ),
    check(
      'fabric_stock_items_measurement_thickness_mm_positive',
      sql`${table.measurementThicknessMm} > 0 AND ${table.measurementThicknessMm} <> 'NaN'::numeric`,
    ),
    check(
      'fabric_stock_items_length_source',
      sql`(
        ${table.isRemnant}
        AND ${table.explicitLengthMm} IS NOT NULL
        AND ${table.radialDepthMm} IS NULL
      ) OR (
        NOT ${table.isRemnant} AND ${table.explicitLengthMm} IS NULL
      )`,
    ),
    check(
      'fabric_stock_items_measurement_inputs',
      sql`(
        ${table.radialDepthMm} IS NULL AND ${table.measurementThicknessMm} IS NULL
      ) OR (
        ${table.radialDepthMm} IS NOT NULL
        AND ${table.tubeOuterDiameterMm} IS NOT NULL
        AND ${table.measurementThicknessMm} IS NOT NULL
      )`,
    ),
    check(
      'fabric_stock_items_source_not_self',
      sql`${table.sourceStockItemId} <> ${table.id}`,
    ),
  ],
);
