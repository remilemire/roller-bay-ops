import { ConflictException, NotFoundException } from '@nestjs/common';
import type { AllocationRecord } from './allocations.repository.js';

export function requireActiveRevision(
  row: AllocationRecord | undefined,
  revision?: number,
): AllocationRecord {
  if (!row) throw new NotFoundException('Allocation not found.');
  if (row.completedAt || row.cancelledAt)
    throw new ConflictException('Only active allocations can be changed.');
  if (revision !== undefined && row.revision !== revision)
    throw new ConflictException(
      'Allocation changed; refresh before submitting.',
    );
  return row;
}
