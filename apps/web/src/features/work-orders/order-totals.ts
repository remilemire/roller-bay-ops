import {
  orderStatusSchema,
  type WorkOrder,
} from '@roller-bay/shared/work-orders';

/** `1 blind`, `14 blinds` */
export const blindCount = (count: number) =>
  `${count} ${count === 1 ? 'blind' : 'blinds'}`;
export const orderCount = (count: number) =>
  `${count} ${count === 1 ? 'order' : 'orders'}`;
export const totalBlinds = (orders: WorkOrder[]) =>
  orders.reduce((total, order) => total + order.quantity, 0);

/** `12 orders · 96 blinds · 5 scheduled · 4 allocated`; empty statuses drop out. */
export function orderTotals(orders: WorkOrder[]) {
  const byStatus = orderStatusSchema.options
    .map((status) => ({
      status,
      count: orders.filter((order) => order.status === status).length,
    }))
    .filter(({ count }) => count)
    .map(({ status, count }) => `${count} ${status}`);
  return [
    orderCount(orders.length),
    blindCount(totalBlinds(orders)),
    ...byStatus,
  ].join(' · ');
}
