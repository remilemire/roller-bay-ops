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
import type { DatabaseExecutor } from '../../database/database-executor.js';
import { milestoneTimestampField } from '../work-orders/work-order-milestones.js';
import { workOrders } from '../work-orders/work-orders.table.js';
import type { CompletionValues } from './production-completions.table.js';
import { productionCompletions } from './production-completions.table.js';
export class ProductionRepository {
  constructor(private readonly db: DatabaseExecutor) {}
  async list(station: Station, query: StationQuery) {
    const stamp = workOrders[milestoneTimestampField[station]];
    const where = and(
      isNull(workOrders.deletedAt),
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
        quantity: sql<number>`(SELECT coalesce(sum(quantity),0)::int FROM work_order_lines WHERE work_order_id = "work_orders"."id" AND retired_at IS NULL)`,
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
      ? await this.db
          .select()
          .from(productionCompletions)
          .where(
            inArray(
              productionCompletions.workOrderId,
              rows.map((row) => row.id),
            ),
          )
      : [];
    const items = rows.map((row) => ({
      ...row,
      completions: completions.filter((c) => c.workOrderId === row.id),
    }));
    return { items, total: total!.total, page: query.page, pageSize: 25 };
  }
  completions(orderId: string) {
    return this.db
      .select()
      .from(productionCompletions)
      .where(eq(productionCompletions.workOrderId, orderId));
  }
  async save(
    workOrderId: string,
    station: Station,
    values: CompletionValues | null,
  ) {
    if (values)
      await this.db
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
