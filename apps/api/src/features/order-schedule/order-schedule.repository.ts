import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  eq,
  ilike,
  isNotNull,
  isNull,
  sql,
} from 'drizzle-orm';
import type {
  CreateScheduledOrder,
  ScheduledOrderQuery,
} from '@roller-bay/shared/order-schedule';
import {
  DatabaseService,
  type DatabaseTransaction,
} from '../../database/database.service.js';
import { scheduledOrders } from './order-schedule.table.js';

type OrderScheduleDatabase = Pick<
  DatabaseService['db'],
  'select' | 'insert' | 'update' | 'delete' | 'transaction'
>;
export type ScheduledOrderRecord = typeof scheduledOrders.$inferSelect;

const { allocatedAt, cutAt, shippedAt } = scheduledOrders;
const statusFilters = {
  open: isNull(shippedAt),
  scheduled: and(isNull(allocatedAt), isNull(cutAt), isNull(shippedAt)),
  allocated: and(isNotNull(allocatedAt), isNull(cutAt), isNull(shippedAt)),
  cut: and(isNotNull(cutAt), isNull(shippedAt)),
  shipped: isNotNull(shippedAt),
};

@Injectable()
export class OrderScheduleRepository {
  private readonly db: OrderScheduleDatabase;
  constructor(
    @Inject(DatabaseService) connection: { db: OrderScheduleDatabase },
  ) {
    this.db = connection.db;
  }

  withTransaction<T>(
    operation: (
      repository: OrderScheduleRepository,
      tx: DatabaseTransaction,
    ) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      // Allocation work may hold an order's row lock while it plans stock.
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      return operation(new OrderScheduleRepository({ db: tx }), tx);
    });
  }

  list(query: ScheduledOrderQuery) {
    const where = and(
      query.search
        ? ilike(
            scheduledOrders.orderNumber,
            `%${query.search.replace(/[\\%_]/g, '\\$&')}%`,
          )
        : undefined,
      query.status ? statusFilters[query.status] : undefined,
    );
    return this.db.transaction(
      async (tx) => {
        const items = await tx
          .select()
          .from(scheduledOrders)
          .where(where)
          .orderBy(
            asc(scheduledOrders.shipDate),
            asc(scheduledOrders.orderNumber),
          )
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize);
        const [result] = await tx
          .select({ total: count() })
          .from(scheduledOrders)
          .where(where);
        return { items, total: result!.total };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }

  async findById(id: string) {
    const [row] = await this.db
      .select()
      .from(scheduledOrders)
      .where(eq(scheduledOrders.id, id));
    return row;
  }

  /**
   * Row locks for edits and milestone stamps are `no key update`: unlike
   * `update`, it does not conflict with the key-share lock an allocation's
   * foreign key already holds on its order, so two requests for one order
   * wait on each other instead of deadlocking.
   */
  async findByIdForUpdate(id: string) {
    const [row] = await this.db
      .select()
      .from(scheduledOrders)
      .where(eq(scheduledOrders.id, id))
      .for('no key update');
    return row;
  }

  async findByOrderNumberForUpdate(orderNumber: string) {
    const [row] = await this.db
      .select()
      .from(scheduledOrders)
      .where(eq(scheduledOrders.orderNumber, orderNumber))
      .for('no key update');
    return row;
  }

  async create(values: CreateScheduledOrder) {
    const [row] = await this.db
      .insert(scheduledOrders)
      .values(values)
      .returning();
    return row!;
  }

  async update(
    id: string,
    values: Partial<
      Pick<ScheduledOrderRecord, 'shipDate' | 'note' | 'shippedAt'>
    >,
  ) {
    const [row] = await this.db
      .update(scheduledOrders)
      .set({
        ...values,
        revision: sql`${scheduledOrders.revision} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(scheduledOrders.id, id))
      .returning();
    return row!;
  }

  /**
   * Milestones mirrored from the order's allocation. They leave `revision`
   * alone: they touch columns no edit writes, and the row lock already
   * serialises them against edits, so allocating fabric never makes an
   * admin's open edit stale.
   */
  async stamp(
    id: string,
    values: Partial<Pick<ScheduledOrderRecord, 'allocatedAt' | 'cutAt'>>,
  ) {
    const [row] = await this.db
      .update(scheduledOrders)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(scheduledOrders.id, id))
      .returning();
    return row!;
  }

  /**
   * Checks the revision in the delete itself, which takes its own row lock;
   * locking first with the weaker edit lock would mean upgrading it while an
   * allocation may hold the order's key-share lock.
   */
  async delete(id: string, revision: number) {
    const [row] = await this.db
      .delete(scheduledOrders)
      .where(
        and(eq(scheduledOrders.id, id), eq(scheduledOrders.revision, revision)),
      )
      .returning();
    return row;
  }
}
