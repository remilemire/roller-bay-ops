import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type { DatabaseTransaction } from '../../database/database.service.js';
import { cuttingWorksheets } from './cutting-worksheets.table.js';
@Injectable()
export class CuttingWorksheetsRepository {
  async find(tx: DatabaseTransaction, id: string, lock = false) {
    const q = tx
      .select()
      .from(cuttingWorksheets)
      .where(eq(cuttingWorksheets.id, id));
    return (await (lock ? q.for('no key update') : q))[0];
  }
  async forAllocation(tx: DatabaseTransaction, id: string) {
    return (
      await tx
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
  async forOrder(tx: DatabaseTransaction, id: string) {
    return (
      await tx
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
  list(tx: DatabaseTransaction) {
    return tx
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
  async hasSuccessors(tx: DatabaseTransaction, id: string) {
    return (
      (
        await tx
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
  async latestForStock(tx: DatabaseTransaction, id: string) {
    return (
      await tx
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
  async create(
    tx: DatabaseTransaction,
    values: typeof cuttingWorksheets.$inferInsert,
  ) {
    return (await tx.insert(cuttingWorksheets).values(values).returning())[0]!;
  }
  async update(
    tx: DatabaseTransaction,
    id: string,
    values: Partial<typeof cuttingWorksheets.$inferInsert>,
  ) {
    return (
      await tx
        .update(cuttingWorksheets)
        .set({ ...values, revision: sql`${cuttingWorksheets.revision}+1` })
        .where(eq(cuttingWorksheets.id, id))
        .returning()
    )[0]!;
  }
}
