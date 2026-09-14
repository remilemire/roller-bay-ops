import { pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

export const notes = pgTable('notes', {
  id: uuid('id').defaultRandom().primaryKey(),
  title: varchar('title', { length: 120 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});
