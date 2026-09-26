import type { WorkOrder } from '@roller-bay/shared/work-orders';
/**
 * An open order's missing fabric: the purchase orders its back order still
 * waits on, or, for a date kept after its allocation was cancelled, that it
 * needs one.
 */
export function AllocationWarning({ order }: { order: WorkOrder }) {
  if (order.allocatedAt || order.cancelledAt || order.shippedAt) return null;
  if (order.backOrder) {
    const awaiting = order.backOrder.awaitingPurchaseOrderNumbers;
    return (
      <span className="back-order-note">
        {awaiting.length
          ? `Back order · awaiting PO ${awaiting.join(', ')}`
          : 'Back order · received, ready to allocate'}
      </span>
    );
  }
  return order.shipDate ? (
    <span className="allocation-warning">Needs fabric allocation</span>
  ) : null;
}
