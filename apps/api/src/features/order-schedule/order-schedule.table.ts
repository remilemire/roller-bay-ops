import { sql } from 'drizzle-orm';
import {
  check,
  date,
  integer,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const scheduledOrders = pgTable(
  'scheduled_orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderNumber: varchar('order_number', { length: 6 }).notNull().unique(),
    // A calendar date; shipping has no time of day or timezone.
    shipDate: date('ship_date', { mode: 'string' }).notNull(),
    // Blinds on the order; its allocation's blinds add up to this.
    quantity: integer('quantity').notNull(),
    note: varchar('note', { length: 1000 }),
    // Milestones. The status is derived from the furthest one reached.
    // scheduled_at doubles as the creation time.
    scheduledAt: timestamp('scheduled_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    allocatedAt: timestamp('allocated_at', { withTimezone: true }),
    cutAt: timestamp('cut_at', { withTimezone: true }),
    shippedAt: timestamp('shipped_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    revision: integer('revision').default(1).notNull(),
  },
  (table) => [
    check(
      'scheduled_orders_order_number_format',
      sql`${table.orderNumber} ~ '^[0-9]{6}$'`,
    ),
    // Orders ship Monday to Friday (ISO weekdays 1-5).
    check(
      'scheduled_orders_ship_date_weekday',
      sql`EXTRACT(ISODOW FROM ${table.shipDate}) < 6`,
    ),
    check('scheduled_orders_quantity_positive', sql`${table.quantity} > 0`),
    check('scheduled_orders_revision_positive', sql`${table.revision} > 0`),
    // allocated_at and cut_at mirror the order's one live allocation, which is
    // confirmed before it is completed.
    check(
      'scheduled_orders_cut_requires_allocated',
      sql`${table.cutAt} IS NULL OR ${table.allocatedAt} IS NOT NULL`,
    ),
  ],
);
