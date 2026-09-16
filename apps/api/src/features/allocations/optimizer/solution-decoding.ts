/** Reconstructs domain drops and checks modeled objectives against independent plan accounting. */
import type {
  CuttingContext,
  CuttingPlan,
} from '@roller-bay/shared/allocations';
import type { SolveResult } from '../../../solver/solver.contracts.js';
import { toMillimetres } from '../cutting-plan/cutting-dimensions.js';
import { validateCuttingPlan } from '../cutting-plan/cutting-plan.validator.js';
import type { CuttingModel } from './cutting-model.js';
import type { CuttingOptimizationResult } from './cutting-plan-optimizer.types.js';
import { CuttingOptimizationError } from './optimization.errors.js';

type Solution = Extract<SolveResult, { status: 'optimal' | 'feasible' }>;

export function decodeSolution(
  context: CuttingContext,
  model: CuttingModel,
  solution: Solution,
): Extract<CuttingOptimizationResult, { status: 'feasible' }> {
  const fail = (): never => {
    throw new CuttingOptimizationError(
      'invalid_solution',
      'Solver solution does not match a valid cutting plan and its accounting.',
    );
  };
  const plan: CuttingPlan = { drops: [] };
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
      if (plan.drops.length >= 100) fail();
      plan.drops.push({
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
  const expected = [
    BigInt(summary.wasteAreaMm2.replace('.', '')),
    BigInt(summary.newRollCount),
    BigInt(summary.dropCount),
    BigInt(summary.stockItemCount),
  ];
  for (const [index, terms] of model.objectives.entries()) {
    let value = 0n;
    for (const term of terms) {
      const count = solution.values[term.variable];
      if (count === undefined || !Number.isSafeInteger(count)) fail();
      value += BigInt(term.coefficient) * BigInt(count!);
    }
    if (index === 0) value *= model.wasteUnit;
    if (value !== expected[index]) fail();
  }
  return { status: 'feasible', plan, summary };
}
