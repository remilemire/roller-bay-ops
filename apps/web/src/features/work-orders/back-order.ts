import type { ErrorIssue } from '@roller-bay/shared/errors';
import { issuePath } from '@/lib/errors';

/** Whether an issue concerns the back order, or one of its numbers. */
export const isPurchaseOrderIssue = (issue: ErrorIssue) =>
  /^backOrder(\.purchaseOrderNumbers(\.\d+)?)?$/.test(issuePath(issue));
