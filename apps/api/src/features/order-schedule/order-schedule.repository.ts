import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  eq,
  gte,
  ilike,
  isNotNull,
  isNull,
  lte,
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

// Deleted orders are kept for their number and history; reads leave them out.
const present = isNull(scheduledOrders.deletedAt);

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
      present,
      query.search
        ? ilike(
            scheduledOrders.orderNumber,
            `%${query.search.replace(/[\\%_]/g, '\\$&')}%`,
          )
        : undefined,
      query.status ? statusFilters[query.status] : undefined,
      query.shipDateFrom
        ? gte(scheduledOrders.shipDate, query.shipDateFrom)
        : undefined,
      query.shipDateTo
        ? lte(scheduledOrders.shipDate, query.shipDateTo)
        : undefined,
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
      .where(and(eq(scheduledOrders.id, id), present));
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
      .where(and(eq(scheduledOrders.id, id), present))
      .for('no key update');
    return row;
  }

  async findByOrderNumber(orderNumber: string) {
    const [row] = await this.db
      .select()
      .from(scheduledOrders)
      .where(and(eq(scheduledOrders.orderNumber, orderNumber), present));
    return row;
  }

  async findByOrderNumberForUpdate(orderNumber: string) {
    const [row] = await this.db
      .select()
      .from(scheduledOrders)
      .where(and(eq(scheduledOrders.orderNumber, orderNumber), present))
      .for('no key update');
    return row;
  }

  /**
   * Schedules a new order, or restores the deleted one that holds the number.
   * Returns nothing when the number belongs to an order still on the schedule.
   * A restored row is recognisable by its revision, which a new row starts at 1.
   */
  async create(values: CreateScheduledOrder) {
    const [row] = await this.db
      .insert(scheduledOrders)
      .values(values)
      .onConflictDoUpdate({
        target: scheduledOrders.orderNumber,
        set: {
          ...values,
          scheduledAt: new Date(),
          shippedAt: null,
          deletedAt: null,
          revision: sql`${scheduledOrders.revision} + 1`,
          updatedAt: new Date(),
        },
        setWhere: isNotNull(scheduledOrders.deletedAt),
      })
      .returning();
    return row;
  }

  async update(
    id: string,
    values: Partial<
      Pick<ScheduledOrderRecord, 'shipDate' | 'quantity' | 'note' | 'shippedAt'>
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

  /** The service locks the row and checks it may go; see findByIdForUpdate. */
  async delete(id: string) {
    await this.db
      .update(scheduledOrders)
      .set({
        deletedAt: new Date(),
        revision: sql`${scheduledOrders.revision} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(scheduledOrders.id, id));
  }
}
