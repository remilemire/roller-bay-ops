import type { WorkOrder } from '@roller-bay/shared/work-orders';
/**
 * An open order's missing fabric: the back order it waits on, or, for a date
 * kept after its allocation was cancelled, that it needs one.
 */
export function AllocationWarning({ order }: { order: WorkOrder }) {
  if (order.allocatedAt || order.cancelledAt || order.shippedAt) return null;
  if (order.backOrder)
    return (
      <span className="back-order-note">
        Back order · PO {order.backOrder.purchaseOrderNumbers.join(', ')}
      </span>
    );
  return order.shipDate ? (
    <span className="allocation-warning">Needs fabric allocation</span>
  ) : null;
}
