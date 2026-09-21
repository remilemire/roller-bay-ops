import {
  workOrderDetailSchema,
  workOrderSchema,
  type WorkOrder,
  type WorkOrderDetail,
} from '@roller-bay/shared/work-orders';
import type {
  WorkOrderLineRecord,
  WorkOrderRecord,
} from './work-orders.repository.js';

// The status is the furthest step reached; it is never stored. A ship date
// can only follow an allocation, so `scheduled` outranks `allocated`.
export function presentWorkOrder(row: WorkOrderRecord): WorkOrder {
  return workOrderSchema.parse({
    ...row,
    status: row.shippedAt
      ? 'shipped'
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
    shippedAt: row.shippedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  });
}

export function presentWorkOrderDetail(
  row: WorkOrderRecord,
  lines: WorkOrderLineRecord[],
): WorkOrderDetail {
  return workOrderDetailSchema.parse({
    ...presentWorkOrder(row),
    lines: lines.map((line) => ({
      id: line.id,
      fabricColorId: line.fabricColorId,
      widthMm: Number(line.widthMm),
      lengthMm: Number(line.lengthMm),
      quantity: line.quantity,
    })),
  });
}
