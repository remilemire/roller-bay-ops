import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type { DatabaseExecutor } from '../../database/database-executor.js';
import { cuttingWorksheets } from './cutting-worksheets.table.js';
export class CuttingWorksheetsRepository {
  constructor(private readonly db: DatabaseExecutor) {}
  async find(id: string, lock = false) {
    const q = this.db
      .select()
      .from(cuttingWorksheets)
      .where(eq(cuttingWorksheets.id, id));
    return (await (lock ? q.for('no key update') : q))[0];
  }
  async forAllocation(id: string) {
    return (
      await this.db
        .select()
        .from(cuttingWorksheets)
        .where(
          and(
            eq(cuttingWorksheets.allocationId, id),
            isNull(cuttingWorksheets.abandonedAt),
            isNull(cuttingWorksheets.skippedAt),
          ),
        )
    )[0];
  }
  async forOrder(id: string) {
    return (
      await this.db
        .select()
        .from(cuttingWorksheets)
        .where(
          and(
            eq(cuttingWorksheets.workOrderId, id),
            isNull(cuttingWorksheets.abandonedAt),
            isNull(cuttingWorksheets.skippedAt),
          ),
        )
        .orderBy(desc(cuttingWorksheets.startedAt))
    )[0];
  }
  list() {
    return this.db
      .select()
      .from(cuttingWorksheets)
      .where(
        and(
          isNull(cuttingWorksheets.reviewedAt),
          isNull(cuttingWorksheets.abandonedAt),
          isNull(cuttingWorksheets.skippedAt),
        ),
      )
      .orderBy(asc(cuttingWorksheets.sequence));
  }
  async hasSuccessors(id: string) {
    return (
      (
        await this.db
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
      await this.db
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
  async create(values: typeof cuttingWorksheets.$inferInsert) {
    return (
      await this.db.insert(cuttingWorksheets).values(values).returning()
    )[0]!;
  }
  async update(
    id: string,
    values: Partial<typeof cuttingWorksheets.$inferInsert>,
  ) {
    return (
      await this.db
        .update(cuttingWorksheets)
        .set({ ...values, revision: sql`${cuttingWorksheets.revision}+1` })
        .where(eq(cuttingWorksheets.id, id))
        .returning()
    )[0]!;
  }
}
