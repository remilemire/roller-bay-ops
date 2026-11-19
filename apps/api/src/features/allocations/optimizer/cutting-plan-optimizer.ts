import type { CuttingContext } from '@roller-bay/shared/allocations';
import {
  planningDefaults,
  type PlanningSettings,
} from '../../../config/planning.js';
import type { SolverClient } from '../../../solver/solver.client.js';
import { BoundedRefinement } from './bounded-refinement.js';
import type {
  CuttingOptimizationOptions,
  ValidatedCuttingPlan,
} from './cutting-plan-optimizer.types.js';
import { findFeasiblePlan } from './feasibility-search.js';
import { checkCancellation } from './optimization.errors.js';
import {
  parseOptimizationContext,
  parseOptimizationOptions,
} from './optimization.input.js';

function score({ summary }: ValidatedCuttingPlan) {
  return [
    BigInt(summary.wasteAreaMm2.replace('.', '')),
    BigInt(summary.newRollCount),
    BigInt(summary.cutCount),
    BigInt(summary.stockItemCount),
  ];
}
function improves(
  candidate: ValidatedCuttingPlan,
  baseline: ValidatedCuttingPlan,
) {
  const current = score(baseline);
  for (const [i, value] of score(candidate).entries()) {
    if (value !== current[i]) return value < current[i]!;
  }
  return false;
}

export class CuttingPlanOptimizer {
  private readonly refinement: BoundedRefinement | null;
  constructor(
    solver: SolverClient | null,
    private readonly settings: Pick<
      PlanningSettings,
      | 'CUTTING_MAX_BLINDS'
      | 'CUTTING_REFINEMENT_SECONDS'
      | 'CUTTING_MAX_PATTERNS'
      | 'CUTTING_MAX_PATTERN_NODES'
      | 'CUTTING_MAX_ASSIGNMENTS'
    > = planningDefaults,
    private readonly reportRefinementFailure?: (error: unknown) => void,
  ) {
    this.refinement =
      solver &&
      new BoundedRefinement(solver, {
        patterns: settings.CUTTING_MAX_PATTERNS,
        nodes: settings.CUTTING_MAX_PATTERN_NODES,
        assignments: settings.CUTTING_MAX_ASSIGNMENTS,
      });
  }

  prepare(context: CuttingContext) {
    return parseOptimizationContext(context, this.settings.CUTTING_MAX_BLINDS);
  }

  async optimize(
    input: CuttingContext,
    options: CuttingOptimizationOptions = {},
    onFeasible?: (result: ValidatedCuttingPlan) => Promise<void>,
  ) {
    const { signal, maxTimeSeconds } = parseOptimizationOptions(options);
    const context = this.prepare(input);
    const first = await findFeasiblePlan(context, signal);
    if (first.status === 'infeasible') return first;
    await onFeasible?.(first);
    const seconds = Math.min(
      maxTimeSeconds ?? this.settings.CUTTING_REFINEMENT_SECONDS,
      this.settings.CUTTING_REFINEMENT_SECONDS,
    );
    if (!this.refinement || seconds === 0) return first;
    let best = first;
    try {
      await this.refinement.optimize(
        context,
        { signal, maxTimeSeconds: seconds },
        first.plan,
        (candidate) => {
          if (improves(candidate, best)) best = candidate;
        },
      );
    } catch (error) {
      checkCancellation(signal);
      // Transport, numeric range and invalid solver output affect refinement
      // only. Preserve the independently validated plan and log the cause.
      this.reportRefinementFailure?.(error);
    }
    return best;
  }
}
