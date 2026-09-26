import type { ErrorIssue } from '@roller-bay/shared/errors';
import type { BackOrder } from '@roller-bay/shared/work-orders';
import { issuePath } from '@/lib/errors';

/**
 * Purchase orders are typed into one box, separated by commas or spaces.
 * Only digits and separators are kept.
 */
export const purchaseOrderInput = (value: string) =>
  value.replace(/[^\d,\s]/g, '');
export const purchaseOrderText = (backOrder: BackOrder | null) =>
  backOrder?.purchaseOrderNumbers.join(', ') ?? '';
export const backOrderOf = (text: string): BackOrder => ({
  purchaseOrderNumbers: text.split(/[\s,]+/).filter(Boolean),
});
/** Whether an issue concerns the back order, or one of its numbers. */
export const isPurchaseOrderIssue = (issue: ErrorIssue) =>
  /^backOrder(\.purchaseOrderNumbers(\.\d+)?)?$/.test(issuePath(issue));
