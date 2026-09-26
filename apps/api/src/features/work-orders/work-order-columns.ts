import { getTableColumns, sql, type SQL } from 'drizzle-orm';
import { stockReceipts } from '../stock-receipts/tables.js';
import { workOrderPurchaseOrders } from './work-order-purchase-orders.table.js';
import { workOrders } from './work-orders.table.js';

// Select-field SQL drops table qualifiers, which would let the subqueries'
// columns bind to the wrong table, so these name them through aliases.
const orderId = sql`${sql.identifier('work_orders')}.${sql.identifier('id')}`;
/** Whether an order has a back order. */
export const backOrdered = sql<boolean>`EXISTS (SELECT 1 FROM ${workOrderPurchaseOrders} po WHERE po.work_order_id = ${orderId})`;
const numbers = (where: SQL = sql`TRUE`) =>
  sql<
    string[]
  >`coalesce((SELECT array_agg(po.purchase_order_number ORDER BY po.purchase_order_number) FROM ${workOrderPurchaseOrders} po WHERE po.work_order_id = ${orderId} AND ${where}), '{}')`;
/**
 * An order as every reader selects it: its row, with its back order's
 * purchase orders (none when it has no back order) and those still awaited.
 * A purchase order has arrived once a submitted stock receipt carries its
 * number.
 */
export const workOrderColumns = {
  ...getTableColumns(workOrders),
  purchaseOrderNumbers: numbers(),
  awaitingPurchaseOrderNumbers: numbers(
    sql`NOT EXISTS (SELECT 1 FROM ${stockReceipts} receipt WHERE receipt.purchase_order_number = po.purchase_order_number AND NOT receipt.is_draft)`,
  ),
};
