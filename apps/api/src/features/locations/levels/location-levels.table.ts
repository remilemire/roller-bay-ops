import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { locationSections } from '../sections/location-sections.table.js';

export const locations = pgTable(
  'locations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => locationSections.id, { onDelete: 'restrict' }),
    label: varchar('label', { length: 40 }).notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex('locations_section_label_unique').on(
      table.sectionId,
      sql`lower(${table.label})`,
    ),
    check(
      'locations_label_format',
      sql`length(${table.label}) > 0 AND ${table.label} !~ '^[[:space:]]|[[:space:]]$'`,
    ),
    check('locations_sort_order_nonnegative', sql`${table.sortOrder} >= 0`),
  ],
);
