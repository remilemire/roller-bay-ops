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

export const locationZones = pgTable(
  'location_zones',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 120 }).notNull(),
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
    uniqueIndex('location_zones_name_unique').on(sql`lower(${table.name})`),
    check(
      'location_zones_name_format',
      sql`length(${table.name}) > 0 AND ${table.name} !~ '^[[:space:]]|[[:space:]]$'`,
    ),
    check(
      'location_zones_sort_order_nonnegative',
      sql`${table.sortOrder} >= 0`,
    ),
  ],
);
