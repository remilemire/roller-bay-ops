import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { manufacturers } from './manufacturers.table.js';

export const fabricMaterials = pgTable(
  'fabric_materials',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    manufacturerId: uuid('manufacturer_id')
      .notNull()
      .references(() => manufacturers.id, { onDelete: 'restrict' }),
    name: varchar('name', { length: 120 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('fabric_materials_manufacturer_id_idx').on(table.manufacturerId),
    check(
      'fabric_materials_name_not_blank',
      sql`length(btrim(${table.name})) > 0`,
    ),
  ],
);
