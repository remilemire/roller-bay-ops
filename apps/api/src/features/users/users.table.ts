import { userRoles } from '@roller-bay/shared/users';
import { sql } from 'drizzle-orm';
import {
  boolean,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', userRoles);

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 120 }).notNull(),
    role: userRoleEnum('role').default('user').notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    email: varchar('email', { length: 254 }).notNull(),
    microsoftSubjectId: text('microsoft_subject_id').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('users_email_unique').on(sql`lower(${table.email})`),
    uniqueIndex('users_single_owner_unique')
      .on(table.role)
      .where(sql`${table.role} = 'owner'`),
  ],
);
