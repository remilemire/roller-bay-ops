import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  ne,
  sql,
  type SQL,
} from 'drizzle-orm';
import type {
  AllocationQuery,
  CreateAllocation,
} from '@roller-bay/shared/allocations';
import {
  DatabaseService,
  type DatabaseTransaction,
} from '../../database/database.service.js';
import { stockItems } from '../stock-items/stock-items.table.js';
import { allocations } from './tables/allocations.table.js';
import { allocationRequirements } from './tables/allocation-requirements.table.js';
import { allocationItems } from './tables/allocation-items.table.js';
import { allocationCuts } from './tables/allocation-cuts.table.js';
import { allocationCutItems } from './tables/allocation-cut-items.table.js';
import type { CuttingPlanSummary } from './cutting-plan/cutting-plan.types.js';

type AllocationDatabase = Pick<
  DatabaseService['db'],
  'select' | 'selectDistinct' | 'insert' | 'update' | 'delete' | 'transaction'
>;
export type AllocationRecord = typeof allocations.$inferSelect;
const active = () =>
  and(isNull(allocations.completedAt), isNull(allocations.cancelledAt));
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
    const query = this.db
      .select()
      .from(allocations)
      .where(eq(allocations.id, id));
    const [row] = await (lock ? query.for('update') : query);
    return row;
  }
  async findByKey(userId: string, key: string) {
    const [row] = await this.db
      .select()
      .from(allocations)
      .where(
        and(
          eq(allocations.createdByUserId, userId),
          eq(allocations.idempotencyKey, key),
        ),
      );
    return row;
  }
  async create(values: typeof allocations.$inferInsert) {
    const [row] = await this.db
      .insert(allocations)
      .values(values)
      .onConflictDoNothing({
        target: [allocations.createdByUserId, allocations.idempotencyKey],
      })
      .returning();
    return row;
  }
  async initializePlan(
    id: string,
    settings: CreateAllocation['settings'],
    plannedSummary: CuttingPlanSummary,
  ) {
    const [row] = await this.db
      .update(allocations)
      .set({ settings, plannedSummary })
      .where(eq(allocations.id, id))
      .returning();
    return row!;
  }
  async saveCompletionFlags(
    id: string,
    completion: NonNullable<AllocationRecord['completion']>,
  ) {
    const [row] = await this.db
      .update(allocations)
      .set({ completion })
      .where(eq(allocations.id, id))
      .returning();
    return row!;
  }
  async update(id: string, values: Partial<typeof allocations.$inferInsert>) {
    const [row] = await this.db
      .update(allocations)
      .set({
        ...values,
        revision: sql`${allocations.revision} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(allocations.id, id))
      .returning();
    return row!;
  }
  items(id: string) {
    return this.db
      .select()
      .from(allocationItems)
      .where(eq(allocationItems.allocationId, id))
      .orderBy(asc(allocationItems.stockItemId));
  }
  requirements(id: string) {
    return this.db
      .select()
      .from(allocationRequirements)
      .where(eq(allocationRequirements.allocationId, id))
      .orderBy(asc(allocationRequirements.id));
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
      .orderBy(asc(allocationItems.stockItemId), asc(allocationCuts.position));
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
      drops: rows.map(({ cut, stockItemId }) => ({
        stockItemId,
        lengthMm: Number(cut.plannedLengthMm),
        items: (byCut.get(cut.id) ?? []).map((item) => ({
          requirementId: item.allocationRequirementId,
          quantity: item.quantity,
        })),
      })),
    };
  }

  async replacePlan(
    id: string,
    input: CreateAllocation,
    summary: CuttingPlanSummary,
  ) {
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
    await this.db
      .delete(allocationRequirements)
      .where(eq(allocationRequirements.allocationId, id));
    for (const batch of batches(input.requirements))
      await this.db.insert(allocationRequirements).values(
        batch.map((item) => ({
          ...item,
          allocationId: id,
          widthMm: item.widthMm.toFixed(3),
          lengthMm: item.lengthMm.toFixed(3),
          lengthAllowanceMm: item.lengthAllowanceMm.toFixed(3),
        })),
      );
    const itemRows: (typeof allocationItems.$inferSelect)[] = [];
    for (const batch of batches(summary.reservations))
      itemRows.push(
        ...(await this.db
          .insert(allocationItems)
          .values(
            batch.map((item) => ({
              allocationId: id,
              stockItemId: item.stockItemId,
              reservedLengthMm: item.reservedLengthMm.toFixed(3),
            })),
          )
          .returning()),
      );
    const byStock = new Map(
      itemRows.map((item) => [item.stockItemId, item.id]),
    );
    const positions = new Map<string, number>();
    const inputs = input.plan.drops.map((drop) => {
      const position = (positions.get(drop.stockItemId) ?? 0) + 1;
      positions.set(drop.stockItemId, position);
      return {
        drop,
        values: {
          allocationItemId: byStock.get(drop.stockItemId)!,
          position,
          plannedLengthMm: drop.lengthMm.toFixed(3),
          edgeTrimMm: input.settings.edgeTrimMm.toFixed(3),
        },
      };
    });
    const cutItemValues: (typeof allocationCutItems.$inferInsert)[] = [];
    for (const batch of batches(inputs)) {
      const cuts = await this.db
        .insert(allocationCuts)
        .values(batch.map((entry) => entry.values))
        .returning();
      const cutMap = new Map(
        cuts.map((cut) => [`${cut.allocationItemId}:${cut.position}`, cut.id]),
      );
      for (const { drop, values } of batch)
        for (const [index, item] of drop.items.entries())
          cutItemValues.push({
            allocationCutId: cutMap.get(
              `${values.allocationItemId}:${values.position}`,
            )!,
            allocationRequirementId: item.requirementId,
            position: index + 1,
            quantity: item.quantity,
          });
    }
    for (const batch of batches(cutItemValues))
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
    return new Map(rows.map((row) => [row.stockItemId, row.reserved]));
  }

  async affectedAllocations(stockIds?: string[], allocationIds?: string[]) {
    if (stockIds?.length === 0 || allocationIds?.length === 0) return [];
    const total = sql`(SELECT coalesce(sum(ai.reserved_length_mm), 0) FROM allocation_items ai JOIN allocations a ON a.id = ai.allocation_id
      WHERE ai.stock_item_id = ${stockItems.id} AND a.completed_at IS NULL AND a.cancelled_at IS NULL)`;
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
          sql`(${stockItems.consumedAt} IS NOT NULL OR ${stockItems.remainingLengthMm} < ${total})`,
          stockIds ? inArray(stockItems.id, stockIds) : undefined,
          allocationIds ? inArray(allocations.id, allocationIds) : undefined,
        ),
      );
    return rows.map((row) => row.id).sort();
  }

  async list(query: AllocationQuery) {
    const state: SQL | undefined =
      query.state === 'active'
        ? active()
        : query.state === 'completed'
          ? isNotNull(allocations.completedAt)
          : query.state === 'cancelled'
            ? isNotNull(allocations.cancelledAt)
            : undefined;
    const where = and(
      state,
      query.search
        ? ilike(
            allocations.orderNumber,
            `%${query.search.replace(/[\\%_]/g, '\\$&')}%`,
          )
        : undefined,
    );
    const items = await this.db
      .select()
      .from(allocations)
      .where(where)
      .orderBy(desc(allocations.createdAt), desc(allocations.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    const [total] = await this.db
      .select({ total: count() })
      .from(allocations)
      .where(where);
    return {
      items,
      total: total!.total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }
}
