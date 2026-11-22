/**
 * Ranks bounded candidates by fresh rolls, remnant coverage, waste, cuts, and
 * stock handling in successive solver passes. Only proven objective values are
 * locked. Every incumbent is decoded and independently validated before return.
 */
import { planningDefaults } from '../../../config/planning.js';
import { setImmediate } from 'node:timers/promises';
import type { CuttingContext } from '@roller-bay/shared/allocations';
import type { SolverClient } from '../../../solver/solver.client.js';
import { SolverError } from '../../../solver/solver.errors.js';
import { solverModelSchema } from '../../../solver/solver.contracts.js';
import type {
  CuttingOptimizationOptions,
  BoundedOptimizationResult,
  ValidatedCuttingPlan,
} from './cutting-plan-optimizer.types.js';
import {
  OPTIMIZATION_LIMITS,
  parseOptimizationOptions,
} from './optimization.input.js';
import {
  generatePatterns,
  type CandidateLimits,
} from './pattern-generation.js';
import { buildCuttingModel, modelFitsTransport } from './cutting-model.js';
import { decodeSolution } from './solution-decoding.js';
import {
  checkCancellation,
  CuttingOptimizationError,
} from './optimization.errors.js';
import { remnantBlindCount } from './cutting-plan-score.js';

export class BoundedRefinement {
  constructor(
    private readonly solver: SolverClient,
    private readonly limits: CandidateLimits = OPTIMIZATION_LIMITS,
  ) {}

  async optimize(
    context: CuttingContext,
    optionsInput: CuttingOptimizationOptions = {},
    seed?: ValidatedCuttingPlan,
    onValidated?: (result: ValidatedCuttingPlan) => void,
  ): Promise<BoundedOptimizationResult> {
    const options = parseOptimizationOptions(optionsInput);
    checkCancellation(options.signal);
    const candidates = await generatePatterns(
      seed?.summary.newRollCount === 0
        ? {
            ...context,
            stockItems: context.stockItems.filter(
              (stock) => stock.isUsed || stock.isRemnant,
            ),
          }
        : context,
      options.signal,
      this.limits,
      seed?.plan,
    );
    if (candidates.impossible) return { status: 'infeasible' };
    const compiled = buildCuttingModel(context, candidates);
    await setImmediate();
    checkCancellation(options.signal);
    if (!compiled) return { status: 'unknown', reason: 'model_limit' };
    let remaining =
      options.maxTimeSeconds ?? planningDefaults.CUTTING_REFINEMENT_SECONDS;
    let incumbent: ValidatedCuttingPlan | undefined;
    // Preserve both stock priorities established on the full inventory.
    if (seed) {
      compiled.model.constraints.push(
        {
          terms: compiled.objectives[0],
          operator: '==',
          rhs: seed.summary.newRollCount,
        },
        {
          terms: compiled.objectives[1],
          operator: '==',
          rhs: -remnantBlindCount(context, seed.plan),
        },
      );
    }
    const objectives = seed
      ? compiled.objectives.slice(2)
      : compiled.objectives;
    for (const terms of objectives) {
      checkCancellation(options.signal);
      if (remaining <= 0) break;
      if (incumbent && !terms.length) continue;
      const model = {
        ...compiled.model,
        objective: { direction: 'minimize' as const, terms },
      };
      if (!modelFitsTransport(model, remaining))
        return incumbent ?? { status: 'unknown', reason: 'model_limit' };
      const parsed = solverModelSchema.safeParse(model);
      if (!parsed.success)
        throw new CuttingOptimizationError(
          'invalid_model',
          'Generated cutting model failed validation.',
          { cause: parsed.error },
        );
      let result;
      try {
        result = await this.solver.solve(model, {
          maxTimeSeconds: remaining,
          signal: options.signal,
        });
      } catch (error) {
        checkCancellation(options.signal);
        if (error instanceof SolverError && error.code === 'timeout')
          return incumbent ?? { status: 'unknown', reason: 'search_limit' };
        throw error;
      }
      checkCancellation(options.signal);
      // This is a shared search budget, not an end-to-end HTTP deadline.
      remaining -= result.wallTimeSeconds;
      if (result.status === 'model_invalid')
        throw new CuttingOptimizationError(
          'invalid_model',
          'Solver rejected the generated cutting model.',
        );
      if (result.status === 'infeasible') {
        if (incumbent || seed)
          throw new CuttingOptimizationError(
            'invalid_solution',
            'Solver contradicted a previously validated incumbent.',
          );
        // Failure in a truncated candidate set cannot establish that the order is impossible.
        return compiled.complete
          ? { status: 'infeasible' }
          : { status: 'unknown', reason: 'search_limit' };
      }
      if (result.status === 'unknown') break;
      incumbent = decodeSolution(context, compiled, result);
      onValidated?.(incumbent);
      if (result.status !== 'optimal') break;
      if (result.objectiveValue === null)
        throw new CuttingOptimizationError(
          'invalid_solution',
          'Solver omitted the objective value.',
        );
      // Lock only proven optima: later preferences must never trade away an
      // earlier objective. A merely feasible result ends the search instead.
      compiled.model.constraints.push({
        terms,
        operator: '==',
        rhs: result.objectiveValue,
      });
    }
    return incumbent ?? { status: 'unknown', reason: 'search_limit' };
  }
}
