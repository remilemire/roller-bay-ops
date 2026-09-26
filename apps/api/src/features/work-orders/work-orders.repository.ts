import type { Station } from '@roller-bay/shared/users';
import type { WorkOrderQuery } from '@roller-bay/shared/work-orders';
import {
  and,
  asc,
  count,
  eq,
  getTableColumns,
  gte,
  ilike,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import type { DatabaseExecutor } from '../../database/database-executor.js';
import { milestoneTimestampField } from './work-order-milestones.js';
import { workOrders } from './work-orders.table.js';
const columns = getTableColumns(workOrders);
export type WorkOrderRecord = typeof workOrders.$inferSelect;
/** The columns a new or restored order is written with. */
export type NewWorkOrder = Pick<
  WorkOrderRecord,
  | 'orderNumber'
  | 'quantity'
  | 'note'
  | 'shipDate'
  | 'scheduledAt'
  | 'backOrderPurchaseOrderNumber'
  | 'backOrderArrivalDate'
>;
const { allocatedAt, cutAt, assembledAt, checkedAt, shipDate, shippedAt } =
  workOrders;
// Each mirrors the presenter's derived status, except the two work queues.
const statusFilters = {
  open: isNull(shippedAt),
  // Allocated (perhaps already cut) or back-ordered, and still waiting for a
  // ship date.
  unscheduled: and(
    or(
      isNotNull(allocatedAt),
      isNotNull(workOrders.backOrderPurchaseOrderNumber),
    ),
    isNull(shipDate),
    isNull(shippedAt),
  ),
  // What an allocation may claim: not shipped, and no live allocation yet.
  // A promised order whose allocation was cancelled is among them.
  unallocated: and(isNull(allocatedAt), isNull(shippedAt)),
  new: and(
    isNull(allocatedAt),
    isNull(shipDate),
    isNull(cutAt),
    isNull(assembledAt),
    isNull(checkedAt),
    isNull(shippedAt),
  ),
  allocated: and(
    isNotNull(allocatedAt),
    isNull(shipDate),
    isNull(cutAt),
    isNull(assembledAt),
    isNull(checkedAt),
    isNull(shippedAt),
  ),
  scheduled: and(
    isNotNull(shipDate),
    isNull(cutAt),
    isNull(assembledAt),
    isNull(checkedAt),
    isNull(shippedAt),
  ),
  cut: and(
    isNotNull(cutAt),
    isNull(assembledAt),
    isNull(checkedAt),
    isNull(shippedAt),
  ),
  assembled: and(isNotNull(assembledAt), isNull(checkedAt), isNull(shippedAt)),
  checked: and(isNotNull(checkedAt), isNull(shippedAt)),
  shipped: isNotNull(shippedAt),
  cancelled: isNotNull(workOrders.cancelledAt),
};
// Deleted orders are kept for their number and history; reads leave them out.
const present = isNull(workOrders.deletedAt);
export class WorkOrdersRepository {
  constructor(private readonly db: DatabaseExecutor) {}
  async list(query: WorkOrderQuery) {
    const where = and(
      present,
      query.search
        ? ilike(
            workOrders.orderNumber,
            `%${query.search.replace(/[\\%_]/g, '\\$&')}%`,
          )
        : undefined,
      query.status ? statusFilters[query.status] : undefined,
      query.status && query.status !== 'cancelled'
        ? isNull(workOrders.cancelledAt)
        : undefined,
      query.shipDateFrom
        ? gte(workOrders.shipDate, query.shipDateFrom)
        : undefined,
      query.shipDateTo ? lte(workOrders.shipDate, query.shipDateTo) : undefined,
    );
    const items = await this.db
      .select(columns)
      .from(workOrders)
      .where(where)
      // Ascending order puts undated orders after the dated ones.
      .orderBy(asc(workOrders.shipDate), asc(workOrders.orderNumber))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    const [result] = await this.db
      .select({ total: count() })
      .from(workOrders)
      .where(where);
    return { items, total: result!.total };
  }
  async findById(id: string) {
    const [row] = await this.db
      .select(columns)
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
      .select(columns)
      .from(workOrders)
      .where(and(eq(workOrders.id, id), present))
      .for('no key update');
    return row;
  }
  /**
   * Creates an order, or restores the deleted one that holds the number.
   * Returns nothing when the number belongs to an order that still exists.
   * A restored row is recognisable by its revision, which a new row starts at 1.
   */
  async create(values: NewWorkOrder) {
    const [row] = await this.db
      .insert(workOrders)
      .values(values)
      .onConflictDoUpdate({
        target: workOrders.orderNumber,
        // A deleted order had no allocation or date; every field it can be
        // created with is written, so nothing of the old one carries over.
        set: {
          ...values,
          shippedAt: null,
          deletedAt: null,
          revision: sql`${workOrders.revision} + 1`,
          updatedAt: new Date(),
        },
        setWhere: isNotNull(workOrders.deletedAt),
      })
      .returning({ id: workOrders.id });
    return row && this.findById(row.id);
  }
  async update(
    id: string,
    values: Partial<
      Pick<
        WorkOrderRecord,
        | 'shipDate'
        | 'scheduledAt'
        | 'note'
        | 'quantity'
        | 'backOrderPurchaseOrderNumber'
        | 'backOrderArrivalDate'
        | 'shippedAt'
        | 'allocatedAt'
        | 'cancelledAt'
        | 'cancellationReason'
      >
    >,
  ) {
    await this.db
      .update(workOrders)
      .set({
        ...values,
        revision: sql`${workOrders.revision} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(workOrders.id, id));
    return (await this.findById(id))!;
  }
  async setProductionMilestone(id: string, station: Station, at: Date | null) {
    await this.db
      .update(workOrders)
      .set({
        [milestoneTimestampField[station]]: at,
        updatedAt: new Date(),
        revision: sql`${workOrders.revision}+1`,
      })
      .where(eq(workOrders.id, id));
    return (await this.findById(id))!;
  }
  /**
   * The allocation stamp leaves `revision`
   * alone: they touch columns no edit writes, and the row lock already
   * serialises them against edits, so allocating fabric never makes an
   * admin's open edit stale.
   */
  async stamp(id: string, values: Pick<WorkOrderRecord, 'allocatedAt'>) {
    await this.db
      .update(workOrders)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(workOrders.id, id));
    return (await this.findById(id))!;
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
