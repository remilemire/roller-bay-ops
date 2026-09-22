import {
  userRoles,
  type Station,
  type MeasurementUnits,
} from '@roller-bay/shared/users';
import { sql } from 'drizzle-orm';
import {
  boolean,
  jsonb,
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
    stations: jsonb('stations').$type<Station[]>().notNull().default([]),
    isActive: boolean('is_active').default(true).notNull(),
    email: varchar('email', { length: 254 }).notNull(),
    microsoftSubjectId: text('microsoft_subject_id').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    // Only explicitly chosen fields are stored; the service merges defaults.
    measurementUnits: jsonb('measurement_units')
      .$type<Partial<MeasurementUnits>>()
      .notNull()
      .default({}),
    // Text rather than an enum so retiring a palette needs no migration; the
    // service resolves unknown values to the default.
    colorTheme: varchar('color_theme', { length: 20 })
      .notNull()
      .default('slate'),
  },
  (table) => [
    uniqueIndex('users_email_unique').on(sql`lower(${table.email})`),
    uniqueIndex('users_single_owner_unique')
      .on(table.role)
      .where(sql`${table.role} = 'owner'`),
  ],
);
