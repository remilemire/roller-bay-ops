import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, sql } from 'drizzle-orm';
import type { StockReceiptQuery } from '@roller-bay/shared/stock-receipts';
import {
  DatabaseService,
  type DatabaseTransaction,
} from '../../database/database.service.js';
import { stockReceipts } from './stock-receipts.table.js';
import { stockReceiptItems } from './stock-receipt-items.table.js';
import { stockReceiptsQuery } from './stock-receipts.persistence.js';

type StockReceiptsDatabase = Pick<
  DatabaseService['db'],
  'select' | 'insert' | 'update' | 'delete' | 'transaction'
>;
export type StockReceiptRecord = typeof stockReceipts.$inferSelect;
export type StockReceiptItemRecord = typeof stockReceiptItems.$inferSelect;

@Injectable()
export class StockReceiptsRepository {
  private readonly db: StockReceiptsDatabase;
  constructor(
    @Inject(DatabaseService) connection: { db: StockReceiptsDatabase },
  ) {
    this.db = connection.db;
  }

  /**
   * Bind all receipt queries to one connection; read snapshots keep header,
   * lines, and stock consistent.
   */
  withTransaction<T>(
    operation: (
      repository: StockReceiptsRepository,
      transaction: DatabaseTransaction,
    ) => Promise<T>,
    readOnly = false,
  ) {
    return stockReceiptsQuery(() =>
      this.db.transaction(
        async (tx) => {
          await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
          await tx.execute(sql`SET LOCAL statement_timeout = '15s'`);
          return operation(new StockReceiptsRepository({ db: tx }), tx);
        },
        readOnly
          ? { isolationLevel: 'repeatable read', accessMode: 'read only' }
          : undefined,
      ),
    );
  }

  async create(input: typeof stockReceipts.$inferInsert) {
    const [row] = await this.db
      .insert(stockReceipts)
      .values(input)
      .onConflictDoNothing({
        target: [stockReceipts.createdByUserId, stockReceipts.idempotencyKey],
      })
      .returning();
    return row;
  }

  async findByKey(userId: string, key: string) {
    const [row] = await this.db
      .select()
      .from(stockReceipts)
      .where(
        and(
          eq(stockReceipts.createdByUserId, userId),
          eq(stockReceipts.idempotencyKey, key),
        ),
      )
      .for('update');
    return row;
  }

  async findById(id: string, lock = false) {
    const query = this.db
      .select()
      .from(stockReceipts)
      .where(eq(stockReceipts.id, id));
    const [row] = await (lock ? query.for('update') : query);
    return row;
  }

  createItems(values: (typeof stockReceiptItems.$inferInsert)[]) {
    return values.length
      ? this.db.insert(stockReceiptItems).values(values).returning()
      : Promise.resolve([]);
  }

  findItems(id: string) {
    return this.db
      .select()
      .from(stockReceiptItems)
      .where(eq(stockReceiptItems.stockReceiptId, id))
      .orderBy(asc(stockReceiptItems.position));
  }

  async update(
    id: string,
    values: Partial<typeof stockReceipts.$inferInsert>,
    incrementRevision = true,
  ) {
    const [row] = await this.db
      .update(stockReceipts)
      .set({
        ...values,
        updatedAt: new Date(),
        ...(incrementRevision
          ? { revision: sql`${stockReceipts.revision} + 1` }
          : {}),
      })
      .where(eq(stockReceipts.id, id))
      .returning();
    return row!;
  }

  async updateItem(
    id: string,
    values: Partial<typeof stockReceiptItems.$inferInsert>,
  ) {
    const [row] = await this.db
      .update(stockReceiptItems)
      .set(values)
      .where(eq(stockReceiptItems.id, id))
      .returning();
    return row!;
  }
  deleteItems(id: string) {
    return this.db
      .delete(stockReceiptItems)
      .where(eq(stockReceiptItems.stockReceiptId, id));
  }

  delete(id: string) {
    return this.db.delete(stockReceipts).where(eq(stockReceipts.id, id));
  }

  async list(query: StockReceiptQuery) {
    const search = query.search
      ? ilike(
          stockReceipts.purchaseOrderNumber,
          `%${query.search.replace(/[\\%_]/g, '\\$&')}%`,
        )
      : undefined;
    const where = and(
      search,
      eq(stockReceipts.isDraft, query.state === 'draft'),
    );
    const items = await this.db
      .select()
      .from(stockReceipts)
      .where(where)
      .orderBy(
        desc(
          query.state === 'draft'
            ? stockReceipts.updatedAt
            : stockReceipts.submittedAt,
        ),
        desc(stockReceipts.id),
      )
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    const [result] = await this.db
      .select({ total: count() })
      .from(stockReceipts)
      .where(where);
    return {
      items,
      total: result!.total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
}
