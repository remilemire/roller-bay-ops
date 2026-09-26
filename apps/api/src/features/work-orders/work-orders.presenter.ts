import {
  workOrderSchema,
  type BackOrder,
  type WorkOrder,
} from '@roller-bay/shared/work-orders';
import type { WorkOrderRecord } from './work-orders.repository.js';

export const backOrderOf = ({
  purchaseOrderNumbers,
}: Pick<WorkOrderRecord, 'purchaseOrderNumbers'>): BackOrder | null =>
  purchaseOrderNumbers.length ? { purchaseOrderNumbers } : null;

// The status is the furthest step reached; it is never stored. A promised
// date survives fabric release, so `scheduled` can have no current allocation.
export function presentWorkOrder(row: WorkOrderRecord): WorkOrder {
  return workOrderSchema.parse({
    ...row,
    backOrder: row.purchaseOrderNumbers.length
      ? {
          purchaseOrderNumbers: row.purchaseOrderNumbers,
          awaitingPurchaseOrderNumbers: row.awaitingPurchaseOrderNumbers,
        }
      : null,
    status: row.cancelledAt
      ? 'cancelled'
      : row.shippedAt
        ? 'shipped'
        : row.checkedAt
          ? 'checked'
          : row.assembledAt
            ? 'assembled'
            : row.cutAt
              ? 'cut'
              : row.shipDate
                ? 'scheduled'
                : row.allocatedAt
                  ? 'allocated'
                  : 'new',
    createdAt: row.createdAt.toISOString(),
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    allocatedAt: row.allocatedAt?.toISOString() ?? null,
    cutAt: row.cutAt?.toISOString() ?? null,
    assembledAt: row.assembledAt?.toISOString() ?? null,
    checkedAt: row.checkedAt?.toISOString() ?? null,
    shippedAt: row.shippedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  });
}
