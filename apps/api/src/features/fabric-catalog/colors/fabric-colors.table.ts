import { sql } from 'drizzle-orm';
import {
  check,
  index,
  numeric,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { fabricMaterials } from '../materials/fabric-materials.table.js';

export const fabricColors = pgTable(
  'fabric_colors',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    materialId: uuid('material_id')
      .notNull()
      .references(() => fabricMaterials.id, { onDelete: 'restrict' }),
    code: varchar('code', { length: 16 }).notNull().unique(),
    thicknessMm: numeric('thickness_mm', { precision: 10, scale: 3 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('fabric_colors_material_id_idx').on(table.materialId),
    // Supplier codes are copied verbatim from manufacturer price lists, which use
    // '/' for split shades (NB1-WHT/GR) and '.' in numeric series (CHR02.02).
    check(
      'fabric_colors_code_format',
      sql`${table.code} ~ '^[A-Z0-9./-]{1,16}$'`,
    ),
    check(
      'fabric_colors_thickness_mm_positive',
      sql`${table.thicknessMm} > 0 AND ${table.thicknessMm} <> 'NaN'::numeric`,
    ),
  ],
);
