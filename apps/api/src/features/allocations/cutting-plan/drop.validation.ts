/**
 * Checks only drop geometry: fixed orientation, outside trims, and drop length.
 * Returns issues only; it never constructs leftovers or calculates waste.
 */
import type {
  CuttingPlanIssue,
  ResolvedAssignment,
  ResolvedDrop,
  ResolvedCuttingPlan,
} from './cutting-plan.types.js';
import { toLengthUnits } from './cutting-dimensions.js';

function longestLength(assignments: readonly ResolvedAssignment[]): bigint {
  return assignments.reduce(
    (longest, assignment) =>
      assignment.length > longest ? assignment.length : longest,
    0n,
  );
}

function validateDrop(drop: ResolvedDrop, trim: bigint): CuttingPlanIssue[] {
  const issues: CuttingPlanIssue[] = [];
  const path = `plan.drops.${drop.index}`;
  if (drop.length !== longestLength(drop.assignments))
    issues.push({
      code: 'drop_length',
      path: `${path}.lengthMm`,
      message:
        'Drop length must equal the longest assigned length including allowance.',
    });
  const width = drop.assignments.reduce(
    (total, assignment) =>
      total + assignment.width * BigInt(assignment.quantity),
    0n,
  );
  if (width + 2n * trim > toLengthUnits(drop.stock.widthMm))
    issues.push({
      code: 'width_capacity',
      path,
      message: 'Widths plus the two outside-edge trims exceed stock width.',
    });
  return issues;
}

export function validateDrops(plan: ResolvedCuttingPlan): CuttingPlanIssue[] {
  const trim = toLengthUnits(plan.settings.edgeTrimMm);
  return plan.drops.flatMap((drop) => validateDrop(drop, trim));
}
