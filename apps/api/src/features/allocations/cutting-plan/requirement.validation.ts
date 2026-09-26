/**
 * Checks that assignments fulfill the order: matching colors, no repeated entries
 * within a cut, and exactly the requested total quantity across the plan.
 */
import type {
  CuttingPlanIssue,
  ResolvedCut,
  ResolvedCuttingPlan,
} from './cutting-plan.types.js';

function validateAssignments(cut: ResolvedCut): CuttingPlanIssue[] {
  const issues: CuttingPlanIssue[] = [];
  const seen = new Set<string>();
  for (const [index, assignment] of cut.assignments.entries()) {
    const path = `plan.cuts.${cut.index}.items.${index}`;
    if (seen.has(assignment.requirement.id))
      issues.push({
        code: 'duplicate_requirement',
        path,
        message:
          'This blind is already in the cut; raise its quantity instead.',
      });
    seen.add(assignment.requirement.id);
    if (assignment.requirement.fabricColorId !== cut.stock.fabricColorId)
      issues.push({
        code: 'color_mismatch',
        path,
        message: "The blind's color does not match this stock.",
      });
  }
  return issues;
}

function validateQuantities(plan: ResolvedCuttingPlan): CuttingPlanIssue[] {
  const counts = new Map<string, number>();
  for (const cut of plan.cuts)
    for (const assignment of cut.assignments) {
      const id = assignment.requirement.id;
      counts.set(id, (counts.get(id) ?? 0) + assignment.quantity);
    }
  return plan.requirements
    .filter(
      (requirement) =>
        (counts.get(requirement.id) ?? 0) !== requirement.quantity,
    )
    .map((requirement) => ({
      code: 'quantity_mismatch',
      path: `context.requirements.${requirement.id}`,
      message: 'The plan cuts a different quantity of this blind.',
    }));
}

export function validateRequirements(
  plan: ResolvedCuttingPlan,
): CuttingPlanIssue[] {
  return [
    ...plan.cuts.flatMap(validateAssignments),
    ...validateQuantities(plan),
  ];
}
