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
import { locationZones } from '../zones/location-zones.table.js';

export const locationSections = pgTable(
  'location_sections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    zoneId: uuid('zone_id')
      .notNull()
      .references(() => locationZones.id, { onDelete: 'restrict' }),
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
    uniqueIndex('location_sections_zone_label_unique').on(
      table.zoneId,
      sql`lower(${table.label})`,
    ),
    check(
      'location_sections_label_format',
      sql`length(${table.label}) > 0 AND ${table.label} !~ '^[[:space:]]|[[:space:]]$'`,
    ),
    check(
      'location_sections_sort_order_nonnegative',
      sql`${table.sortOrder} >= 0`,
    ),
  ],
);
