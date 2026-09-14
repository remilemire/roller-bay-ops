import { sql } from 'drizzle-orm';
import { check, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const manufacturers = pgTable(
  'manufacturers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 120 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      'manufacturers_name_not_blank',
      sql`length(btrim(${table.name})) > 0`,
    ),
  ],
);
