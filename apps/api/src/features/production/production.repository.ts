import type { StationQuery } from '@roller-bay/shared/production';
import type { Station } from '@roller-bay/shared/users';
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
  lt,
  sql,
} from 'drizzle-orm';
import { cuttingWorksheets } from '../cutting-worksheets/tables.js';
import type { DatabaseExecutor } from '../../database/database-executor.js';
import { milestoneTimestampField, workOrders } from '../work-orders/tables.js';
import type {
  CompletionRecord,
  CompletionValues,
} from './production-completions.table.js';
import {
  productionCompletionEmployees,
  productionCompletions,
} from './production-completions.table.js';
export class ProductionRepository {
  constructor(private readonly db: DatabaseExecutor) {}
  async list(station: Station, query: StationQuery) {
    const stamp = workOrders[milestoneTimestampField[station]];
    const where = and(
      isNull(workOrders.deletedAt),
      isNull(workOrders.cancelledAt),
      isNotNull(workOrders.allocatedAt),
      query.search
        ? ilike(workOrders.orderNumber, `%${query.search}%`)
        : undefined,
      query.view === 'queue'
        ? and(isNull(stamp), isNull(workOrders.shippedAt))
        : undefined,
      query.view === 'completed'
        ? and(gte(stamp, new Date(query.from!)), lt(stamp, new Date(query.to!)))
        : undefined,
    );
    const rows = await this.db
      .select({
        ...getTableColumns(workOrders),
        // Qualify the outer id explicitly: select-field SQL otherwise loses table
        // qualifiers and the subquery compares worksheet.work_order_id to its own id.
        hasCuttingWorksheet: sql<boolean>`EXISTS (SELECT 1 FROM ${cuttingWorksheets} WHERE ${cuttingWorksheets.workOrderId} = ${sql.identifier('work_orders')}.${sql.identifier('id')} AND ${cuttingWorksheets.abandonedAt} IS NULL AND ${cuttingWorksheets.skippedAt} IS NULL)`,
      })
      .from(workOrders)
      .where(where)
      .orderBy(asc(workOrders.shipDate), asc(workOrders.orderNumber))
      .limit(25)
      .offset((query.page - 1) * 25);
    const [total] = await this.db
      .select({ total: count() })
      .from(workOrders)
      .where(where);
    const completions = rows.length
      ? await this.withEmployees(
          await this.db
            .select()
            .from(productionCompletions)
            .where(
              inArray(
                productionCompletions.workOrderId,
                rows.map((row) => row.id),
              ),
            ),
        )
      : [];
    const items = rows.map((row) => ({
      ...row,
      completions: completions.filter((c) => c.workOrderId === row.id),
    }));
    return { items, total: total!.total, page: query.page, pageSize: 25 };
  }
  async completions(orderId: string) {
    return this.withEmployees(
      await this.db
        .select()
        .from(productionCompletions)
        .where(eq(productionCompletions.workOrderId, orderId)),
    );
  }
  private async withEmployees(
    rows: (typeof productionCompletions.$inferSelect)[],
  ): Promise<CompletionRecord[]> {
    const people = rows.length
      ? await this.db
          .select()
          .from(productionCompletionEmployees)
          .where(
            inArray(
              productionCompletionEmployees.workOrderId,
              rows.map((row) => row.workOrderId),
            ),
          )
          .orderBy(
            asc(productionCompletionEmployees.employeeName),
            asc(productionCompletionEmployees.employeeId),
          )
      : [];
    return rows.map((row) => ({
      ...row,
      employees: people
        .filter(
          (p) => p.workOrderId === row.workOrderId && p.station === row.station,
        )
        .map(({ employeeId, employeeName, employeeInitials }) => ({
          employeeId,
          employeeName,
          employeeInitials,
        })),
    }));
  }
  async save(
    workOrderId: string,
    station: Station,
    values: CompletionValues | null,
  ) {
    if (values) {
      const { employees, ...milestone } = values;
      await this.db
        .insert(productionCompletions)
        .values({ ...milestone, workOrderId, station })
        .onConflictDoUpdate({
          target: [
            productionCompletions.workOrderId,
            productionCompletions.station,
          ],
          set: milestone,
        });
      await this.db
        .delete(productionCompletionEmployees)
        .where(
          and(
            eq(productionCompletionEmployees.workOrderId, workOrderId),
            eq(productionCompletionEmployees.station, station),
          ),
        );
      await this.db
        .insert(productionCompletionEmployees)
        .values(employees.map((e) => ({ ...e, workOrderId, station })));
    } else
      // The cascade removes the credited employees.
      await this.db
        .delete(productionCompletions)
        .where(
          and(
            eq(productionCompletions.workOrderId, workOrderId),
            eq(productionCompletions.station, station),
          ),
        );
  }
}
