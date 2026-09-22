import { Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  eq,
  inArray,
  getTableColumns,
  gte,
  ilike,
  isNotNull,
  isNull,
  lt,
  sql,
} from 'drizzle-orm';
import type { Station } from '@roller-bay/shared/users';
import type { StationQuery } from '@roller-bay/shared/production';
import type { DatabaseTransaction } from '../../database/database.service.js';
import { DatabaseService } from '../../database/database.service.js';
import { workOrders } from '../work-orders/work-orders.table.js';
import { productionCompletions } from './production-completions.table.js';
import { milestoneTimestampField } from '../work-orders/work-order-milestones.js';
import type { CompletionValues } from './production-completions.table.js';
@Injectable()
export class ProductionRepository {
  constructor(private readonly database: DatabaseService) {}
  list(station: Station, query: StationQuery) {
    return this.database.transaction(async (tx) => {
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
          ? and(
              gte(stamp, new Date(query.from!)),
              lt(stamp, new Date(query.to!)),
            )
          : undefined,
      );
      const rows = await tx
        .select({
          ...getTableColumns(workOrders),
          quantity: sql<number>`(SELECT coalesce(sum(quantity),0)::int FROM work_order_lines WHERE work_order_id = "work_orders"."id" AND retired_at IS NULL)`,
        })
        .from(workOrders)
        .where(where)
        .orderBy(asc(workOrders.shipDate), asc(workOrders.orderNumber))
        .limit(25)
        .offset((query.page - 1) * 25);
      const [total] = await tx
        .select({ total: count() })
        .from(workOrders)
        .where(where);
      const completions = rows.length
        ? await tx
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
    }, true);
  }
  completions(tx: DatabaseTransaction, orderId: string) {
    return tx
      .select()
      .from(productionCompletions)
      .where(eq(productionCompletions.workOrderId, orderId));
  }
  async save(
    tx: DatabaseTransaction,
    workOrderId: string,
    station: Station,
    values: CompletionValues | null,
  ) {
    if (values)
      await tx
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
      await tx
        .delete(productionCompletions)
        .where(
          and(
            eq(productionCompletions.workOrderId, workOrderId),
            eq(productionCompletions.station, station),
          ),
        );
  }
}
