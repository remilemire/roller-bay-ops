/** Reconstructs domain cuts and checks modeled objectives against independent plan accounting. */
import type {
  CuttingContext,
  CuttingPlan,
} from '@roller-bay/shared/allocations';
import type { SolveResult } from '../../../solver/solver.contracts.js';
import { toMillimetres } from '../cutting-plan/cutting-dimensions.js';
import { validateCuttingPlan } from '../cutting-plan/cutting-plan.validator.js';
import type { CuttingModel } from './cutting-model.js';
import type { ValidatedCuttingPlan } from './cutting-plan-optimizer.types.js';
import { CuttingOptimizationError } from './optimization.errors.js';
import { cuttingPlanScore } from './cutting-plan-score.js';

type Solution = Extract<SolveResult, { status: 'optimal' | 'feasible' }>;

export function decodeSolution(
  context: CuttingContext,
  model: CuttingModel,
  solution: Solution,
): ValidatedCuttingPlan {
  const fail = (): never => {
    throw new CuttingOptimizationError(
      'invalid_solution',
      'Solver solution does not match a valid cutting plan and its accounting.',
    );
  };
  const maxCuts = context.requirements.reduce(
    (sum, item) => sum + item.quantity,
    0,
  );
  const plan: CuttingPlan = { cuts: [] };
  for (const assignment of model.assignments) {
    const count = solution.values[assignment.variable];
    if (
      count === undefined ||
      !Number.isSafeInteger(count) ||
      count < 0 ||
      count > assignment.maximum
    )
      fail();
    for (let i = 0; i < count!; i++) {
      if (plan.cuts.length >= maxCuts) fail();
      plan.cuts.push({
        stockItemId: assignment.stock.id,
        lengthMm: toMillimetres(assignment.pattern.length),
        items: assignment.pattern.items.map((item) => ({
          requirementId: item.requirement.id,
          quantity: item.quantity,
        })),
      });
    }
  }
  const validated = validateCuttingPlan(context, plan);
  if (!validated.valid) return fail();
  const { summary } = validated;
  const decoded = { status: 'feasible' as const, plan, summary };
  const expected = cuttingPlanScore(context, decoded);
  for (const [index, terms] of model.objectives.entries()) {
    let value = 0n;
    for (const term of terms) {
      const count = solution.values[term.variable];
      if (count === undefined || !Number.isSafeInteger(count)) fail();
      value += BigInt(term.coefficient) * BigInt(count!);
    }
    if (index === 2) value *= model.wasteUnit;
    if (value !== expected[index]) fail();
  }
  return decoded;
}
