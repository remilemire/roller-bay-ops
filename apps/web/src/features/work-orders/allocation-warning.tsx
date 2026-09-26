import type { WorkOrder } from '@roller-bay/shared/work-orders';
import { Clock, PackageCheck } from 'lucide-react';
import { Flag } from '@/components/ui/feedback';
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
      <Flag tone="waiting" icon={Clock}>
        {`Back order · awaiting PO ${awaiting.join(', ')}`}
      </Flag>
    ) : (
      <Flag tone="ready" icon={PackageCheck}>
        Back order · received, ready to allocate
      </Flag>
    );
  }
  return order.shipDate ? <Flag>Needs fabric allocation</Flag> : null;
}
