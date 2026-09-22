import { and, eq, sql } from 'drizzle-orm';
import type { Station } from '@roller-bay/shared/users';
import type { DatabaseTransaction } from '../../database/database.service.js';
import { productionCompletions } from './work-order-completions.table.js';
import { workOrders } from './work-orders.table.js';
export const milestoneColumn = {
  cutting: 'cutAt',
  assembly: 'assembledAt',
  checking: 'checkedAt',
  shipping: 'shippedAt',
} as const;
export class WorkOrderProductionRepository {
  constructor(private readonly tx: DatabaseTransaction) {}
  completions(id: string) {
    return this.tx
      .select()
      .from(productionCompletions)
      .where(eq(productionCompletions.workOrderId, id));
  }
  async save(
    workOrderId: string,
    station: Station,
    values: Omit<
      typeof productionCompletions.$inferInsert,
      'workOrderId' | 'station'
    > | null,
  ) {
    if (values)
      await this.tx
        .insert(productionCompletions)
        .values({ ...values, workOrderId, station })
        .onConflictDoUpdate({
          target: [
            productionCompletions.workOrderId,
            productionCompletions.station,
          ],
          set: values,
        });
    else
      await this.tx
        .delete(productionCompletions)
        .where(
          and(
            eq(productionCompletions.workOrderId, workOrderId),
            eq(productionCompletions.station, station),
          ),
        );
    await this.tx
      .update(workOrders)
      .set({
        [milestoneColumn[station]]: values?.completedAt ?? null,
        updatedAt: new Date(),
        revision: sql`${workOrders.revision}+1`,
      })
      .where(eq(workOrders.id, workOrderId));
  }
}
