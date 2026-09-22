import type { Station } from '@roller-bay/shared/users';
import type {
  CreateWorkOrder,
  WorkOrderLine,
  WorkOrderQuery,
} from '@roller-bay/shared/work-orders';
import {
  and,
  asc,
  count,
  eq,
  getTableColumns,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql,
} from 'drizzle-orm';
import type { DatabaseExecutor } from '../../database/database-executor.js';
import { workOrderLines } from './work-order-lines.table.js';
import { milestoneTimestampField } from './work-order-milestones.js';
import { workOrders } from './work-orders.table.js';
// An order's blind count is the total of its blinds, never a stored number.
// The names are spelled out: Drizzle leaves table qualifiers off a
// single-table select, which would compare a line's columns with each other.
const columns = {
  ...getTableColumns(workOrders),
  quantity: sql<number>`(SELECT coalesce(sum(l.quantity), 0)::int FROM work_order_lines l
    WHERE l.work_order_id = "work_orders"."id" AND l.retired_at IS NULL)`,
};
export type WorkOrderRecord = typeof workOrders.$inferSelect & {
  quantity: number;
};
export type WorkOrderLineRecord = typeof workOrderLines.$inferSelect;
const { allocatedAt, cutAt, assembledAt, checkedAt, shipDate, shippedAt } =
  workOrders;
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
      .returning({ id: workOrders.id });
    return row && this.findById(row.id);
  }
  async update(
    id: string,
    values: Partial<
      Pick<WorkOrderRecord, 'shipDate' | 'scheduledAt' | 'note' | 'shippedAt'>
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
  /** Blinds by id, retired or not: what a past plan's cuts were made for. */
  linesById(ids: string[]) {
    if (!ids.length) return Promise.resolve([]);
    return this.db
      .select()
      .from(workOrderLines)
      .where(inArray(workOrderLines.id, ids))
      .orderBy(asc(workOrderLines.position), asc(workOrderLines.id));
  }
  /** The order's blinds in order; retired ones only for a save to compare. */
  lines(workOrderId: string, includeRetired = false) {
    return this.db
      .select()
      .from(workOrderLines)
      .where(
        and(
          eq(workOrderLines.workOrderId, workOrderId),
          includeRetired ? undefined : isNull(workOrderLines.retiredAt),
        ),
      )
      .orderBy(asc(workOrderLines.position), asc(workOrderLines.id));
  }
  async insertLines(
    workOrderId: string,
    lines: (WorkOrderLine & {
      position: number;
    })[],
  ) {
    if (!lines.length) return;
    await this.db.insert(workOrderLines).values(
      lines.map((line) => ({
        ...line,
        workOrderId,
        widthMm: line.widthMm.toFixed(3),
        lengthMm: line.lengthMm.toFixed(3),
      })),
    );
  }
  async moveLine(id: string, position: number) {
    await this.db
      .update(workOrderLines)
      .set({ position })
      .where(eq(workOrderLines.id, id));
  }
  async retireLines(ids: string[]) {
    if (!ids.length) return;
    await this.db
      .update(workOrderLines)
      .set({ retiredAt: new Date() })
      .where(inArray(workOrderLines.id, ids));
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
