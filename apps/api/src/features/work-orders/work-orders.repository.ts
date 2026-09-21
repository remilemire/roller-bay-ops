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
  CreateWorkOrder,
  WorkOrderQuery,
} from '@roller-bay/shared/work-orders';
import {
  DatabaseService,
  type DatabaseTransaction,
} from '../../database/database.service.js';
import { workOrders } from './work-orders.table.js';

type WorkOrdersDatabase = Pick<
  DatabaseService['db'],
  'select' | 'insert' | 'update' | 'delete' | 'transaction'
>;
export type WorkOrderRecord = typeof workOrders.$inferSelect;

const { allocatedAt, cutAt, shipDate, shippedAt } = workOrders;
// Each mirrors the presenter's derived status, except the two work queues.
const statusFilters = {
  open: isNull(shippedAt),
  // Allocated, or already cut, and still waiting for a ship date.
  unscheduled: and(isNotNull(allocatedAt), isNull(shipDate), isNull(shippedAt)),
  new: and(isNull(allocatedAt), isNull(shippedAt)),
  allocated: and(
    isNotNull(allocatedAt),
    isNull(shipDate),
    isNull(cutAt),
    isNull(shippedAt),
  ),
  scheduled: and(isNotNull(shipDate), isNull(cutAt), isNull(shippedAt)),
  cut: and(isNotNull(cutAt), isNull(shippedAt)),
  shipped: isNotNull(shippedAt),
};

// Deleted orders are kept for their number and history; reads leave them out.
const present = isNull(workOrders.deletedAt);

@Injectable()
export class WorkOrdersRepository {
  private readonly db: WorkOrdersDatabase;
  constructor(@Inject(DatabaseService) connection: { db: WorkOrdersDatabase }) {
    this.db = connection.db;
  }

  withTransaction<T>(
    operation: (
      repository: WorkOrdersRepository,
      tx: DatabaseTransaction,
    ) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      // Allocation work may hold an order's row lock while it plans stock.
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      return operation(new WorkOrdersRepository({ db: tx }), tx);
    });
  }

  list(query: WorkOrderQuery) {
    const where = and(
      present,
      query.search
        ? ilike(
            workOrders.orderNumber,
            `%${query.search.replace(/[\\%_]/g, '\\$&')}%`,
          )
        : undefined,
      query.status ? statusFilters[query.status] : undefined,
      query.shipDateFrom
        ? gte(workOrders.shipDate, query.shipDateFrom)
        : undefined,
      query.shipDateTo ? lte(workOrders.shipDate, query.shipDateTo) : undefined,
    );
    return this.db.transaction(
      async (tx) => {
        const items = await tx
          .select()
          .from(workOrders)
          .where(where)
          // Ascending order puts undated orders after the dated ones.
          .orderBy(asc(workOrders.shipDate), asc(workOrders.orderNumber))
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize);
        const [result] = await tx
          .select({ total: count() })
          .from(workOrders)
          .where(where);
        return { items, total: result!.total };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }

  async findById(id: string) {
    const [row] = await this.db
      .select()
      .from(workOrders)
      .where(and(eq(workOrders.id, id), present));
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
      .from(workOrders)
      .where(and(eq(workOrders.id, id), present))
      .for('no key update');
    return row;
  }

  async findByOrderNumber(orderNumber: string) {
    const [row] = await this.db
      .select()
      .from(workOrders)
      .where(and(eq(workOrders.orderNumber, orderNumber), present));
    return row;
  }

  async findByOrderNumberForUpdate(orderNumber: string) {
    const [row] = await this.db
      .select()
      .from(workOrders)
      .where(and(eq(workOrders.orderNumber, orderNumber), present))
      .for('no key update');
    return row;
  }

  /**
   * Schedules a new order, or restores the deleted one that holds the number.
   * Returns nothing when the number belongs to an order still on the schedule.
   * A restored row is recognisable by its revision, which a new row starts at 1.
   */
  async create(values: CreateWorkOrder) {
    const [row] = await this.db
      .insert(workOrders)
      .values(values)
      .onConflictDoUpdate({
        target: workOrders.orderNumber,
        // A deleted order had no allocation, so it has no ship date to clear.
        set: {
          ...values,
          shippedAt: null,
          deletedAt: null,
          revision: sql`${workOrders.revision} + 1`,
          updatedAt: new Date(),
        },
        setWhere: isNotNull(workOrders.deletedAt),
      })
      .returning();
    return row;
  }

  async update(
    id: string,
    values: Partial<
      Pick<
        WorkOrderRecord,
        'shipDate' | 'scheduledAt' | 'quantity' | 'note' | 'shippedAt'
      >
    >,
  ) {
    const [row] = await this.db
      .update(workOrders)
      .set({
        ...values,
        revision: sql`${workOrders.revision} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(workOrders.id, id))
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
    values: Partial<Pick<WorkOrderRecord, 'allocatedAt' | 'cutAt'>>,
  ) {
    const [row] = await this.db
      .update(workOrders)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(workOrders.id, id))
      .returning();
    return row!;
  }

  /** The service locks the row and checks it may go; see findByIdForUpdate. */
  async delete(id: string) {
    await this.db
      .update(workOrders)
      .set({
        deletedAt: new Date(),
        revision: sql`${workOrders.revision} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(workOrders.id, id));
  }
}
