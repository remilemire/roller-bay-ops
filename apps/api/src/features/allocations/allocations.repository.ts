import * as crypto from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  ilike,
  inArray,
  isNull,
  isNotNull,
  ne,
  sql,
  type SQL,
} from 'drizzle-orm';
import type {
  AllocationQuery,
  AllocationDraftData,
} from '@roller-bay/shared/allocations';
import {
  DatabaseService,
  type DatabaseTransaction,
} from '../../database/database.service.js';
import { stockItems } from '../stock-items/stock-items.table.js';
import { workOrders } from '../work-orders/work-orders.table.js';
import { allocations } from './tables/allocations.table.js';
import { allocationItems } from './tables/allocation-items.table.js';
import { allocationCuts } from './tables/allocation-cuts.table.js';
import { allocationCutItems } from './tables/allocation-cut-items.table.js';
import type { CuttingPlanSummary } from './cutting-plan/cutting-plan.types.js';

type AllocationDatabase = Pick<
  DatabaseService['db'],
  'select' | 'selectDistinct' | 'insert' | 'update' | 'delete' | 'transaction'
>;
// Reads carry the order's number, which lives on the work order alone.
const columns = {
  ...getTableColumns(allocations),
  orderNumber: workOrders.orderNumber,
};
export type AllocationRecord = typeof allocations.$inferSelect & {
  orderNumber: string;
};
// Only confirmed, unfinished orders reserve stock; draft selections are not claims.
const active = () =>
  and(
    eq(allocations.isDraft, false),
    isNull(allocations.completedAt),
    isNull(allocations.cancelledAt),
  );
const batches = <T>(values: T[]): T[][] =>
  Array.from({ length: Math.ceil(values.length / 1000) }, (_, index) =>
    values.slice(index * 1000, (index + 1) * 1000),
  );

@Injectable()
export class AllocationsRepository {
  private readonly db: AllocationDatabase;
  constructor(@Inject(DatabaseService) connection: { db: AllocationDatabase }) {
    this.db = connection.db;
  }

  /**
   * Use one connection for allocation and stock work; read-only calls see a
   * consistent snapshot.
   */
  withTransaction<T>(
    operation: (
      repository: AllocationsRepository,
      tx: DatabaseTransaction,
    ) => Promise<T>,
    readOnly = false,
  ): Promise<T> {
    return this.db.transaction(
      async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
        await tx.execute(sql`SET LOCAL statement_timeout = '15s'`);
        return operation(new AllocationsRepository({ db: tx }), tx);
      },
      readOnly
        ? { isolationLevel: 'repeatable read', accessMode: 'read only' }
        : undefined,
    );
  }

  async findById(id: string, lock = false) {
    // The header is locked on its own, then read with its order. Locking
    // through the join would re-check the join after a wait: a draft that the
    // other transaction moved to another order would no longer match the
    // order it was first joined to, and would read as missing.
    if (lock)
      await this.db
        .select({ id: allocations.id })
        .from(allocations)
        .where(eq(allocations.id, id))
        .for('update');
    const [row] = await this.db
      .select(columns)
      .from(allocations)
      .innerJoin(workOrders, eq(workOrders.id, allocations.workOrderId))
      .where(eq(allocations.id, id));
    return row;
  }
  async findByKey(userId: string, key: string) {
    const [found] = await this.db
      .select({ id: allocations.id })
      .from(allocations)
      .where(
        and(
          eq(allocations.createdByUserId, userId),
          eq(allocations.idempotencyKey, key),
        ),
      )
      .for('update');
    return found && this.findById(found.id);
  }
  async create(values: typeof allocations.$inferInsert) {
    const [row] = await this.db
      .insert(allocations)
      .values(values)
      .onConflictDoNothing({
        target: [allocations.createdByUserId, allocations.idempotencyKey],
      })
      .returning({ id: allocations.id });
    return row && this.findById(row.id);
  }
  async initializePlan(
    id: string,
    settings: AllocationDraftData['settings'],
    plannedSummary: CuttingPlanSummary,
    confirmedAt: Date,
  ) {
    await this.db
      .update(allocations)
      .set({
        settings,
        plannedSummary,
        confirmedAt,
        isDraft: false,
      })
      .where(eq(allocations.id, id));
    return (await this.findById(id))!;
  }
  /** A new draft's rules, known once its order's blinds are read; still revision 1. */
  async saveSettings(id: string, settings: AllocationDraftData['settings']) {
    await this.db
      .update(allocations)
      .set({ settings })
      .where(eq(allocations.id, id));
    return (await this.findById(id))!;
  }
  async saveCompletionFlags(
    id: string,
    completion: NonNullable<AllocationRecord['completion']>,
  ) {
    await this.db
      .update(allocations)
      .set({ completion })
      .where(eq(allocations.id, id));
    return (await this.findById(id))!;
  }
  async update(id: string, values: Partial<typeof allocations.$inferInsert>) {
    await this.db
      .update(allocations)
      .set({
        ...values,
        revision: sql`${allocations.revision} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(allocations.id, id));
    return (await this.findById(id))!;
  }
  items(id: string) {
    return this.db
      .select()
      .from(allocationItems)
      .where(eq(allocationItems.allocationId, id))
      .orderBy(asc(allocationItems.stockItemId));
  }
  async plan(id: string) {
    const rows = await this.db
      .select({ cut: allocationCuts, stockItemId: allocationItems.stockItemId })
      .from(allocationCuts)
      .innerJoin(
        allocationItems,
        eq(allocationCuts.allocationItemId, allocationItems.id),
      )
      .where(eq(allocationItems.allocationId, id))
      .orderBy(asc(allocationCuts.planPosition), asc(allocationCuts.id));
    const items = rows.length
      ? await this.db
          .select()
          .from(allocationCutItems)
          .where(
            inArray(
              allocationCutItems.allocationCutId,
              rows.map((row) => row.cut.id),
            ),
          )
          .orderBy(asc(allocationCutItems.position))
      : [];
    const byCut = new Map<string, typeof items>();
    for (const item of items) {
      const group = byCut.get(item.allocationCutId) ?? [];
      group.push(item);
      byCut.set(item.allocationCutId, group);
    }
    return {
      cuts: rows.map(({ cut, stockItemId }) => ({
        stockItemId,
        lengthMm:
          cut.plannedLengthMm === null ? null : Number(cut.plannedLengthMm),
        items: (byCut.get(cut.id) ?? []).map((item) => ({
          // A plan calls the blinds it assigns its requirements.
          requirementId: item.workOrderLineId,
          quantity: item.quantity,
        })),
      })),
    };
  }

  async clearPlan(id: string) {
    const itemIds = this.db
      .select({ id: allocationItems.id })
      .from(allocationItems)
      .where(eq(allocationItems.allocationId, id));
    const cutIds = this.db
      .select({ id: allocationCuts.id })
      .from(allocationCuts)
      .where(inArray(allocationCuts.allocationItemId, itemIds));
    await this.db
      .delete(allocationCutItems)
      .where(inArray(allocationCutItems.allocationCutId, cutIds));
    await this.db
      .delete(allocationCuts)
      .where(inArray(allocationCuts.allocationItemId, itemIds));
    await this.db
      .delete(allocationItems)
      .where(eq(allocationItems.allocationId, id));
  }

  async delete(id: string) {
    await this.clearPlan(id);
    await this.db.delete(allocations).where(eq(allocations.id, id));
  }

  /**
   * Replace the full child graph inside the caller's header-locked
   * transaction. The blinds it assigns are the order's and are not written.
   */
  async replacePlan(
    id: string,
    input: Pick<AllocationDraftData, 'plan' | 'settings'>,
    summary?: CuttingPlanSummary,
  ) {
    await this.clearPlan(id);

    // Unassigned cuts each get a placeholder; selected stock is shared across its cuts.
    const itemKeys = input.plan.cuts.map(
      (cut, index) => cut.stockItemId ?? `unassigned:${index}`,
    );
    const uniqueKeys = [...new Set(itemKeys)];
    const reservations = new Map(
      summary?.reservations.map((item) => [
        item.stockItemId,
        item.reservedLengthMm,
      ]),
    );
    const byKey = new Map<string, string>();
    for (const batch of batches(uniqueKeys)) {
      const values = batch.map((key) => ({
        id: crypto.randomUUID(),
        allocationId: id,
        stockItemId: key.startsWith('unassigned:') ? null : key,
        reservedLengthMm: reservations.get(key)?.toFixed(3) ?? null,
      }));
      await this.db.insert(allocationItems).values(values);
      batch.forEach((key, index) => byKey.set(key, values[index]!.id));
    }
    // Preserve both the whole form's cut order and each stock item's cutting order.
    const positions = new Map<string, number>();
    const inputs = input.plan.cuts.map((cut, index) => {
      const key = itemKeys[index]!;
      const position = (positions.get(key) ?? 0) + 1;
      positions.set(key, position);
      return {
        cut,
        values: {
          id: crypto.randomUUID(),
          allocationItemId: byKey.get(key)!,
          position,
          planPosition: index + 1,
          plannedLengthMm: cut.lengthMm?.toFixed(3) ?? null,
          edgeTrimMm: input.settings.edgeTrimMm?.toFixed(3) ?? null,
        },
      };
    });
    for (const batch of batches(inputs))
      await this.db
        .insert(allocationCuts)
        .values(batch.map((entry) => entry.values));
    const assignments = inputs.flatMap(({ cut, values }) =>
      cut.items.map((item, index) => ({
        allocationCutId: values.id,
        workOrderLineId: item.requirementId,
        position: index + 1,
        quantity: item.quantity,
      })),
    );
    for (const batch of batches(assignments))
      await this.db.insert(allocationCutItems).values(batch);
  }

  async reservations(stockIds: string[], excludeAllocationId?: string) {
    if (!stockIds.length) return new Map<string, string>();
    const rows = await this.db
      .select({
        stockItemId: allocationItems.stockItemId,
        reserved: sql<string>`sum(${allocationItems.reservedLengthMm})::text`,
      })
      .from(allocationItems)
      .innerJoin(allocations, eq(allocationItems.allocationId, allocations.id))
      .where(
        and(
          active(),
          inArray(allocationItems.stockItemId, stockIds),
          excludeAllocationId
            ? ne(allocations.id, excludeAllocationId)
            : undefined,
        ),
      )
      .groupBy(allocationItems.stockItemId);
    return new Map(rows.map((row) => [row.stockItemId!, row.reserved]));
  }

  async affectedAllocations(stockIds?: string[], allocationIds?: string[]) {
    if (stockIds?.length === 0 || allocationIds?.length === 0) return [];
    // Scope only the reported orders, not the total demand on each stock item.
    // Without production priority, every active claimant on short stock needs review.
    const total = sql`(SELECT coalesce(sum(ai.reserved_length_mm), 0) FROM allocation_items ai JOIN allocations a ON a.id = ai.allocation_id
      WHERE ai.stock_item_id = ${stockItems.id} AND a.is_draft = false AND a.completed_at IS NULL AND a.cancelled_at IS NULL)`;
    const rows = await this.db
      .selectDistinct({ id: allocations.id })
      .from(allocations)
      .innerJoin(
        allocationItems,
        eq(allocationItems.allocationId, allocations.id),
      )
      .innerJoin(stockItems, eq(allocationItems.stockItemId, stockItems.id))
      .where(
        and(
          active(),
          sql`(${stockItems.voidedAt} IS NOT NULL OR ${stockItems.consumedAt} IS NOT NULL OR ${stockItems.remainingLengthMm} < ${total}
            OR EXISTS (SELECT 1 FROM allocation_cuts ac JOIN allocation_cut_items aci ON aci.allocation_cut_id = ac.id
              JOIN work_order_lines wl ON wl.id = aci.work_order_line_id
              WHERE ac.allocation_item_id = ${allocationItems.id}
              GROUP BY ac.id, ac.edge_trim_mm HAVING sum(wl.width_mm * aci.quantity) + 2 * coalesce(ac.edge_trim_mm, 0) > ${stockItems.widthMm}))`,
          stockIds ? inArray(stockItems.id, stockIds) : undefined,
          allocationIds ? inArray(allocations.id, allocationIds) : undefined,
        ),
      );
    return rows.map((row) => row.id).sort();
  }

  async list(query: AllocationQuery) {
    const state: SQL =
      query.state === 'draft'
        ? eq(allocations.isDraft, true)
        : and(
            eq(allocations.isDraft, false),
            query.state === 'active'
              ? active()
              : query.state === 'completed'
                ? isNotNull(allocations.completedAt)
                : query.state === 'cancelled'
                  ? isNotNull(allocations.cancelledAt)
                  : undefined,
          )!;
    const where = and(
      state,
      query.search
        ? ilike(
            workOrders.orderNumber,
            `%${query.search.replace(/[\\%_]/g, '\\$&')}%`,
          )
        : undefined,
    );
    const items = await this.db
      .select(columns)
      .from(allocations)
      .innerJoin(workOrders, eq(workOrders.id, allocations.workOrderId))
      .where(where)
      .orderBy(
        desc(
          query.state === 'draft'
            ? allocations.updatedAt
            : allocations.createdAt,
        ),
        desc(allocations.id),
      )
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    const [total] = await this.db
      .select({ total: count() })
      .from(allocations)
      .innerJoin(workOrders, eq(workOrders.id, allocations.workOrderId))
      .where(where);
    return {
      items,
      total: total!.total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
}
