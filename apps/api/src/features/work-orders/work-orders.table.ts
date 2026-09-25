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

export const workOrders = pgTable(
  'work_orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderNumber: varchar('order_number', { length: 6 }).notNull().unique(),
    // A calendar date; shipping has no time of day or timezone. An order has
    // none until fabric is allocated and someone schedules it.
    shipDate: date('ship_date', { mode: 'string' }),
    note: varchar('note', { length: 1000 }),
    // How many blinds the order has. An allocation's blinds must add up to it.
    quantity: integer('quantity').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    // Milestones. The status is derived from the furthest one reached.
    // scheduled_at is when the ship date was set, and goes when it does.
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    allocatedAt: timestamp('allocated_at', { withTimezone: true }),
    cutAt: timestamp('cut_at', { withTimezone: true }),
    assembledAt: timestamp('assembled_at', { withTimezone: true }),
    checkedAt: timestamp('checked_at', { withTimezone: true }),
    shippedAt: timestamp('shipped_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    revision: integer('revision').default(1).notNull(),
    // A deleted order is kept: allocations reference its number, which stays
    // unique, so creating that number again restores this row.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancellationReason: varchar('cancellation_reason', { length: 1000 }),
  },
  (table) => [
    check(
      'work_orders_order_number_format',
      sql`${table.orderNumber} ~ '^[0-9]{6}$'`,
    ),
    // Orders ship Monday to Friday (ISO weekdays 1-5).
    check(
      'work_orders_ship_date_weekday',
      sql`EXTRACT(ISODOW FROM ${table.shipDate}) < 6`,
    ),
    // Allocation is required when scheduling, but may later be released.
    // Scheduling eligibility is checked under the order lock in the service.
    check(
      'work_orders_scheduled_at_matches_ship_date',
      sql`(${table.shipDate} IS NULL) = (${table.scheduledAt} IS NULL)`,
    ),
    check('work_orders_revision_positive', sql`${table.revision} > 0`),
    check('work_orders_quantity_positive', sql`${table.quantity} > 0`),
    // Only an order without a live allocation can be deleted.
    check(
      'work_orders_deleted_unallocated',
      sql`${table.deletedAt} IS NULL OR ${table.allocatedAt} IS NULL`,
    ),
    // Production remains a historical fact after fabric is released.
    check(
      'work_orders_cancellation_valid',
      sql`(${table.cancelledAt} IS NULL AND ${table.cancellationReason} IS NULL) OR (${table.cancelledAt} IS NOT NULL AND ${table.cancellationReason} IS NOT NULL AND ${table.allocatedAt} IS NULL AND ${table.shipDate} IS NULL AND ${table.shippedAt} IS NULL AND ${table.deletedAt} IS NULL)`,
    ),
  ],
);
