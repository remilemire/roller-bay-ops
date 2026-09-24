import type { WorkOrder } from '@roller-bay/shared/work-orders';
export function AllocationWarning({ order }: { order: WorkOrder }) {
  return order.shipDate &&
    !order.allocatedAt &&
    !order.cancelledAt &&
    !order.shippedAt ? (
    <span className="allocation-warning">Needs fabric allocation</span>
  ) : null;
}
