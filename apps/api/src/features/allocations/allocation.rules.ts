import { ConflictException, NotFoundException } from '@nestjs/common';
import type { AllocationRecord } from './allocations.repository.js';

export function requirePlanningRevision(
  row: AllocationRecord | undefined,
  revision?: number,
): AllocationRecord {
  if (!row) throw new NotFoundException('Allocation not found.');
  if (row.completedAt || row.cancelledAt)
    throw new ConflictException(
      'Only draft or active allocations can be planned.',
    );
  if (revision !== undefined && row.revision !== revision)
    throw new ConflictException(
      'Allocation changed; refresh before submitting.',
    );
  return row;
}

export function requireActiveRevision(
  row: AllocationRecord | undefined,
  revision?: number,
): AllocationRecord {
  const record = requirePlanningRevision(row, revision);
  if (record.isDraft)
    throw new ConflictException('Only active allocations can be changed.');
  return record;
}

export function requireDraftRevision(
  row: AllocationRecord | undefined,
  revision: number,
): AllocationRecord {
  const record = requirePlanningRevision(row, revision);
  if (!record.isDraft)
    throw new ConflictException(
      'Only draft allocations can be changed or submitted.',
    );
  return record;
}
