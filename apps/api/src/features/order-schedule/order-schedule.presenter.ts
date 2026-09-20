import {
  scheduledOrderSchema,
  type ScheduledOrder,
} from '@roller-bay/shared/order-schedule';
import type { ScheduledOrderRecord } from './order-schedule.repository.js';

// The status is the furthest milestone reached; it is never stored.
export function presentScheduledOrder(
  row: ScheduledOrderRecord,
): ScheduledOrder {
  return scheduledOrderSchema.parse({
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
