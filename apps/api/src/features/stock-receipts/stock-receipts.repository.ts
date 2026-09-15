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
  'select' | 'insert' | 'transaction'
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
        target: [stockReceipts.submittedByUserId, stockReceipts.idempotencyKey],
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
          eq(stockReceipts.submittedByUserId, userId),
          eq(stockReceipts.idempotencyKey, key),
        ),
      );
    return row;
  }

  async findById(id: string) {
    const [row] = await this.db
      .select()
      .from(stockReceipts)
      .where(eq(stockReceipts.id, id));
    return row;
  }

  createItems(values: (typeof stockReceiptItems.$inferInsert)[]) {
    return this.db.insert(stockReceiptItems).values(values).returning();
  }

  findItems(id: string) {
    return this.db
      .select()
      .from(stockReceiptItems)
      .where(eq(stockReceiptItems.stockReceiptId, id))
      .orderBy(asc(stockReceiptItems.id));
  }

  async list(query: StockReceiptQuery) {
    const where = query.search
      ? ilike(
          stockReceipts.purchaseOrderNumber,
          `%${query.search.replace(/[\\%_]/g, '\\$&')}%`,
        )
      : undefined;
    const items = await this.db
      .select()
      .from(stockReceipts)
      .where(where)
      .orderBy(desc(stockReceipts.submittedAt), desc(stockReceipts.id))
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
