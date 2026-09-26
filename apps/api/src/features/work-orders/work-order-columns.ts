import { getTableColumns, sql } from 'drizzle-orm';
import { workOrderPurchaseOrders } from './work-order-purchase-orders.table.js';
import { workOrders } from './work-orders.table.js';

// Select-field SQL drops table qualifiers, so the outer order's id is named
// explicitly.
const orderId = sql`${sql.identifier('work_orders')}.${sql.identifier('id')}`;
/** Whether an order has a back order. */
export const backOrdered = sql<boolean>`EXISTS (SELECT 1 FROM ${workOrderPurchaseOrders} WHERE ${workOrderPurchaseOrders.workOrderId} = ${orderId})`;
/**
 * An order as every reader selects it: its row, with its back order's
 * purchase orders (none when it has no back order).
 */
export const workOrderColumns = {
  ...getTableColumns(workOrders),
  purchaseOrderNumbers: sql<
    string[]
  >`coalesce((SELECT array_agg(${workOrderPurchaseOrders.purchaseOrderNumber} ORDER BY ${workOrderPurchaseOrders.purchaseOrderNumber}) FROM ${workOrderPurchaseOrders} WHERE ${workOrderPurchaseOrders.workOrderId} = ${orderId}), '{}')`,
};
