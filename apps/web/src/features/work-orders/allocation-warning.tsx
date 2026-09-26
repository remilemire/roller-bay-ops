import type { WorkOrder } from '@roller-bay/shared/work-orders';
import { Clock, PackageCheck, TriangleAlert } from 'lucide-react';
/**
 * An open order's missing fabric: the purchase orders its back order still
 * waits on, or, for a date kept after its allocation was cancelled, that it
 * needs one.
 */
export function AllocationWarning({ order }: { order: WorkOrder }) {
  if (order.allocatedAt || order.cancelledAt || order.shippedAt) return null;
  if (order.backOrder) {
    const awaiting = order.backOrder.awaitingPurchaseOrderNumbers;
    return awaiting.length ? (
      <span className="order-flag order-flag-waiting">
        <Clock size={12} aria-hidden />
        <span>{`Back order · awaiting PO ${awaiting.join(', ')}`}</span>
      </span>
    ) : (
      <span className="order-flag order-flag-ready">
        <PackageCheck size={12} aria-hidden />
        <span>Back order · received, ready to allocate</span>
      </span>
    );
  }
  return order.shipDate ? (
    <span className="order-flag order-flag-warning">
      <TriangleAlert size={12} aria-hidden />
      <span>Needs fabric allocation</span>
    </span>
  ) : null;
}
