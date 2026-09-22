import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { DatabaseTransaction } from '../../database/database.service.js';
import { cuttingWorksheets } from './tables/cutting-worksheets.table.js';
import { allocations } from './tables/allocations.table.js';
import { stockItems } from '../stock-items/stock-items.table.js';
export type WorksheetRow = typeof cuttingWorksheets.$inferSelect;
export class CuttingWorksheetsRepository {
  constructor(private readonly tx: DatabaseTransaction) {}
  async find(id: string, lock = false) {
    const q = this.tx
      .select()
      .from(cuttingWorksheets)
      .where(eq(cuttingWorksheets.id, id));
    return (await (lock ? q.for('no key update') : q))[0];
  }
  async forAllocation(id: string) {
    return (
      await this.tx
        .select()
        .from(cuttingWorksheets)
        .where(
          and(
            eq(cuttingWorksheets.allocationId, id),
            isNull(cuttingWorksheets.abandonedAt),
          ),
        )
    )[0];
  }
  async forOrder(id: string) {
    return (
      await this.tx
        .select()
        .from(cuttingWorksheets)
        .where(
          and(
            eq(cuttingWorksheets.workOrderId, id),
            isNull(cuttingWorksheets.abandonedAt),
          ),
        )
        .orderBy(desc(cuttingWorksheets.startedAt))
    )[0];
  }
  async allocationForOrder(id: string) {
    return (
      await this.tx
        .select({ id: allocations.id })
        .from(allocations)
        .where(
          and(
            eq(allocations.workOrderId, id),
            eq(allocations.isDraft, false),
            isNull(allocations.cancelledAt),
          ),
        )
    )[0];
  }
  list() {
    return this.tx
      .select()
      .from(cuttingWorksheets)
      .where(
        and(
          isNull(cuttingWorksheets.reviewedAt),
          isNull(cuttingWorksheets.abandonedAt),
        ),
      )
      .orderBy(asc(cuttingWorksheets.sequence));
  }
  async hasSuccessors(id: string) {
    return (
      (
        await this.tx
          .select({ id: cuttingWorksheets.id })
          .from(cuttingWorksheets)
          .where(
            and(
              isNull(cuttingWorksheets.abandonedAt),
              sql`EXISTS (SELECT 1 FROM jsonb_each(${cuttingWorksheets.baselines}) b WHERE b.value->>'predecessorId' = ${id})`,
            ),
          )
          .limit(1)
      ).length > 0
    );
  }
  async latestForStock(id: string) {
    return (
      await this.tx
        .select()
        .from(cuttingWorksheets)
        .where(
          and(
            sql`${cuttingWorksheets.baselines} ? ${id}`,
            isNull(cuttingWorksheets.abandonedAt),
          ),
        )
        .orderBy(desc(cuttingWorksheets.sequence))
    )[0];
  }
  async lockStock(ids: string[]) {
    return this.tx
      .select()
      .from(stockItems)
      .where(inArray(stockItems.id, ids))
      .orderBy(asc(stockItems.id))
      .for('no key update');
  }
  async create(values: typeof cuttingWorksheets.$inferInsert) {
    return (
      await this.tx.insert(cuttingWorksheets).values(values).returning()
    )[0]!;
  }
  async update(
    id: string,
    values: Partial<typeof cuttingWorksheets.$inferInsert>,
  ) {
    return (
      await this.tx
        .update(cuttingWorksheets)
        .set({ ...values, revision: sql`${cuttingWorksheets.revision}+1` })
        .where(eq(cuttingWorksheets.id, id))
        .returning()
    )[0]!;
  }
}
