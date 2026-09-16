import {
  allocationSummarySchema,
  allocationDraftSummarySchema,
} from '@roller-bay/shared/allocations';
import type { AllocationRecord } from './allocations.repository.js';

export function allocationSummary(
  row: AllocationRecord,
  needsReplanning: boolean,
) {
  const result = {
    ...row,
    state: row.isDraft
      ? 'draft'
      : row.completedAt
        ? 'completed'
        : row.cancelledAt
          ? 'cancelled'
          : 'active',
    needsReplanning:
      !row.isDraft && !row.completedAt && !row.cancelledAt
        ? needsReplanning
        : false,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
  };
  return !row.isDraft
    ? allocationSummarySchema.parse(result)
    : allocationDraftSummarySchema.parse(result);
}
