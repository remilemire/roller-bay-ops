/**
 * Checks only cut geometry: fixed orientation, outside trims, and cut length.
 * Returns issues only; it never constructs leftovers or calculates waste.
 */
import type {
  CuttingPlanIssue,
  ResolvedAssignment,
  ResolvedCut,
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

function validateCut(cut: ResolvedCut, trim: bigint): CuttingPlanIssue[] {
  const issues: CuttingPlanIssue[] = [];
  const path = `plan.cuts.${cut.index}`;
  if (cut.length !== longestLength(cut.assignments))
    issues.push({
      code: 'cut_length',
      path: `${path}.lengthMm`,
      message:
        'Cut length must equal the longest assigned length including allowance.',
    });
  const width = cut.assignments.reduce(
    (total, assignment) =>
      total + assignment.width * BigInt(assignment.quantity),
    0n,
  );
  if (width + 2n * trim > toLengthUnits(cut.stock.widthMm))
    issues.push({
      code: 'width_capacity',
      path,
      message: 'The blinds and both edge trims are wider than this stock.',
    });
  return issues;
}

export function validateCuts(plan: ResolvedCuttingPlan): CuttingPlanIssue[] {
  const trim = toLengthUnits(plan.settings.edgeTrimMm);
  return plan.cuts.flatMap((cut) => validateCut(cut, trim));
}
