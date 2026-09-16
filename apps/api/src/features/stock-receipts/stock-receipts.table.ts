import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  boolean,
  timestamp,
  uuid,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { users } from '../users/users.table.js';

export const stockReceipts = pgTable(
  'stock_receipts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    isDraft: boolean('is_draft').default(true).notNull(),
    // Nullable together for receipts created before idempotent submission existed.
    idempotencyKey: uuid('idempotency_key'),
    requestHash: varchar('request_hash', { length: 64 }),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    revision: integer('revision').default(1).notNull(),
    submittedDraftRevision: integer('submitted_draft_revision'),
    purchaseOrderNumber: varchar('purchase_order_number', {
      length: 50,
    }),
    submittedByUserId: uuid('submitted_by_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
  },
  (table) => [
    check('stock_receipts_revision_positive', sql`${table.revision} > 0`),
    check(
      'stock_receipts_submission_valid',
      sql`(${table.isDraft} AND ${table.submittedAt} IS NULL AND ${table.submittedByUserId} IS NULL AND ${table.submittedDraftRevision} IS NULL) OR (NOT ${table.isDraft} AND ${table.submittedAt} IS NOT NULL AND ${table.submittedByUserId} IS NOT NULL AND ${table.purchaseOrderNumber} IS NOT NULL)`,
    ),
    check(
      'stock_receipts_submitted_revision_valid',
      sql`${table.submittedDraftRevision} IS NULL OR (${table.submittedDraftRevision} > 0 AND ${table.submittedDraftRevision} < ${table.revision})`,
    ),

    uniqueIndex('stock_receipts_creator_key_unique').on(
      table.createdByUserId,
      table.idempotencyKey,
    ),
    check(
      'stock_receipts_idempotency_pair',
      sql`
      (${table.idempotencyKey} IS NULL AND ${table.requestHash} IS NULL) OR
      (${table.idempotencyKey} IS NOT NULL AND ${table.requestHash} IS NOT NULL AND ${table.requestHash} ~ '^[0-9a-f]{64}$')
    `,
    ),
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
