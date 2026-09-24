import {
  boolean,
  integer,
  pgTable,
  timestamp,
  uuid,
  varchar,
  uniqueIndex,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from '../users/tables.js';
export const employees = pgTable(
  'employees',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 120 }).notNull(),
    initials: varchar('initials', { length: 12 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    linkedUserId: uuid('linked_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    revision: integer('revision').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('employees_linked_user_unique').on(t.linkedUserId),
    check('employees_revision_positive', sql`${t.revision} > 0`),
  ],
);

export type EmployeeRecord = typeof employees.$inferSelect;
