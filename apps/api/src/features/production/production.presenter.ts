import {
  productionCompletionSchema,
  stationOrderListSchema,
} from '@roller-bay/shared/production';
import type { CompletionRecord } from './production-completions.table.js';
import {
  type WorkOrderRecord,
  presentWorkOrder,
} from '../work-orders/index.js';
export const presentCompletion = (row: CompletionRecord) =>
  productionCompletionSchema.parse({
    ...row,
    completedAt: row.completedAt.toISOString(),
    recordedAt: row.recordedAt.toISOString(),
  });
export function presentStationOrders(result: {
  items: (WorkOrderRecord & { completions: CompletionRecord[] })[];
  total: number;
  page: number;
  pageSize: number;
}) {
  return stationOrderListSchema.parse({
    ...result,
    items: result.items.map((row) => ({
      ...presentWorkOrder(row),
      completions: row.completions.map(presentCompletion),
    })),
  });
}
