import { Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  eq,
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
import { DatabaseService } from '../../database/database.service.js';
import { workOrders } from '../work-orders/work-orders.table.js';
import { productionCompletions } from '../work-orders/work-order-completions.table.js';
import { milestoneColumn } from '../work-orders/work-order-production.repository.js';
import { presentCompletion } from '../work-orders/work-order-production.service.js';
import { presentWorkOrder } from '../work-orders/work-orders.presenter.js';
@Injectable()
export class ProductionRepository {
  constructor(private readonly database: DatabaseService) {}
  list(station: Station, query: StationQuery) {
    return this.database.db.transaction(
      async (tx) => {
        const stamp = workOrders[milestoneColumn[station]];
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
        const items = await Promise.all(
          rows.map(async (row) => ({
            ...presentWorkOrder(row),
            completions: (
              await tx
                .select()
                .from(productionCompletions)
                .where(eq(productionCompletions.workOrderId, row.id))
            ).map(presentCompletion),
          })),
        );
        return { items, total: total!.total, page: query.page, pageSize: 25 };
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );
  }
}
