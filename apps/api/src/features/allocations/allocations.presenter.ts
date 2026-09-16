import { allocationSummarySchema } from '@roller-bay/shared/allocations';
import type { AllocationRecord } from './allocations.repository.js';

export function allocationSummary(
  row: AllocationRecord,
  needsReplanning: boolean,
) {
  return allocationSummarySchema.parse({
    ...row,
    state: row.completedAt
      ? 'completed'
      : row.cancelledAt
        ? 'cancelled'
        : 'active',
    needsReplanning,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
  });
}
