import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from '../users/users.table.js';

export const stockReceipts = pgTable(
  'stock_receipts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    purchaseOrderNumber: varchar('purchase_order_number', {
      length: 50,
    }).notNull(),
    submittedByUserId: uuid('submitted_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    submittedAt: timestamp('submitted_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('stock_receipts_purchase_order_number_idx').on(
      table.purchaseOrderNumber,
    ),
    index('stock_receipts_submitted_by_user_id_idx').on(
      table.submittedByUserId,
    ),
    check(
      'stock_receipts_purchase_order_number_format',
      sql`length(${table.purchaseOrderNumber}) > 0 AND ${table.purchaseOrderNumber} !~ '^[[:space:]]|[[:space:]]$'`,
    ),
  ],
);
