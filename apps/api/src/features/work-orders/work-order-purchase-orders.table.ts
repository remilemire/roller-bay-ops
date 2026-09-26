import { sql } from 'drizzle-orm';
import { check, pgTable, primaryKey, uuid, varchar } from 'drizzle-orm/pg-core';
import { workOrders } from './work-orders.table.js';

// A back order: the supplier purchase orders bringing an order's fabric. An
// order with none is not back-ordered. The numbers match stock receipts'
// `purchase_order_number` by value, never by key, since receipts only exist
// once fabric arrives and several may share a number.
export const workOrderPurchaseOrders = pgTable(
  'work_order_purchase_orders',
  {
    workOrderId: uuid('work_order_id')
      .notNull()
      .references(() => workOrders.id, { onDelete: 'cascade' }),
    purchaseOrderNumber: varchar('purchase_order_number', {
      length: 5,
    }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.workOrderId, table.purchaseOrderNumber] }),
    check(
      'work_order_purchase_orders_number_format',
      sql`${table.purchaseOrderNumber} ~ '^[0-9]{5}$'`,
    ),
  ],
);
