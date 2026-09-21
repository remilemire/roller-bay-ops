import {
  workOrderSchema,
  type WorkOrder,
} from '@roller-bay/shared/work-orders';
import type { WorkOrderRecord } from './work-orders.repository.js';

// The status is the furthest milestone reached; it is never stored.
export function presentWorkOrder(row: WorkOrderRecord): WorkOrder {
  return workOrderSchema.parse({
    ...row,
    status: row.shippedAt
      ? 'shipped'
      : row.cutAt
        ? 'cut'
        : row.allocatedAt
          ? 'allocated'
          : 'scheduled',
    scheduledAt: row.scheduledAt.toISOString(),
    allocatedAt: row.allocatedAt?.toISOString() ?? null,
    cutAt: row.cutAt?.toISOString() ?? null,
    shippedAt: row.shippedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  });
}
