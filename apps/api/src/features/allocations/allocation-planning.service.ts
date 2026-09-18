/**
 * Preview snapshots are read consistently, then released before solver work.
 * They reserve nothing; confirmation must revalidate availability under stock locks.
 */
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  allocationOptimizationSchema,
  allocationValidationSchema,
  type OptimizeAllocation,
  type ValidateAllocation,
} from '@roller-bay/shared/allocations';
import { StockItemsService } from '../stock-items/stock-items.service.js';
import { AllocationsRepository } from './allocations.repository.js';
import { allocationOperation } from './allocations.operation.js';
import { requirePlanningRevision } from './allocation.rules.js';
import { buildCuttingContext } from './allocation-cutting-context.js';
import { validateCuttingPlan } from './cutting-plan/cutting-plan.validator.js';
import { CuttingPlanOptimizer } from './optimizer/cutting-plan-optimizer.js';
import { CuttingOptimizationError } from './optimizer/optimization.errors.js';
import {
  CuttingRulesService,
  planCutLengths,
} from './cutting-rules.service.js';
import { SolverError } from '../../solver/solver.errors.js';

@Injectable()
export class AllocationPlanningService {
  constructor(
    private readonly repository: AllocationsRepository,
    private readonly stockItems: StockItemsService,
    @Inject(CuttingPlanOptimizer)
    private readonly optimizer: CuttingPlanOptimizer | null,
    private readonly cuttingRules: CuttingRulesService,
  ) {}

  async optimize(input: OptimizeAllocation, signal?: AbortSignal) {
    if (!this.optimizer)
      throw new ServiceUnavailableException(
        'Configure SOLVER_API_KEY to enable optimization.',
      );
    const snapshot = await this.snapshot(input);
    // Over-reserved stock is unavailable, not malformed user input. Replanning
    // excludes this allocation's own reservation before applying this filter.
    snapshot.context.stockItems = snapshot.context.stockItems.filter(
      (item) => item.reservedLengthMm <= item.remainingLengthMm,
    );
    try {
      const result = await this.optimizer.optimize(snapshot.context, {
        maxTimeSeconds: input.maxTimeSeconds,
        signal,
      });
      return allocationOptimizationSchema.parse({
        ...result,
        stockItems:
          result.status === 'feasible'
            ? snapshot.stock.filter((item) =>
                result.plan.cuts.some((cut) => cut.stockItemId === item.id),
              )
            : [],
      });
    } catch (error) {
      // Only order-level codes carry text meant for the requester. Schema,
      // model, and solver faults keep their detail in the cause for the log.
      if (
        error instanceof CuttingOptimizationError &&
        ['invalid_input', 'numeric_range'].includes(error.code)
      )
        throw new BadRequestException(error.message, { cause: error });
      if (error instanceof SolverError && error.code === 'busy')
        throw new ConflictException(
          'The optimizer is busy; try again shortly.',
          { cause: error },
        );
      if (
        (error instanceof CuttingOptimizationError ||
          error instanceof SolverError) &&
        error.code === 'cancelled'
      )
        throw new ConflictException('Optimization cancelled.', {
          cause: error,
        });
      throw new ServiceUnavailableException('Optimization is unavailable.', {
        cause: error,
      });
    }
  }

  async validate(input: ValidateAllocation) {
    const snapshot = await this.snapshot(input, [
      ...new Set(input.plan.cuts.map((cut) => cut.stockItemId)),
    ]);
    return allocationValidationSchema.parse({
      ...validateCuttingPlan(
        snapshot.context,
        planCutLengths(snapshot.context.requirements, input.plan),
      ),
      stockItems: snapshot.stock,
    });
  }

  private snapshot(
    input: OptimizeAllocation | ValidateAllocation,
    stockIds?: string[],
  ) {
    return allocationOperation(() =>
      this.repository.withTransaction(async (repository, tx) => {
        const header = input.allocationId
          ? requirePlanningRevision(
              await repository.findById(input.allocationId),
              input.expectedRevision,
            )
          : undefined;
        const configured = this.cuttingRules.apply(
          input.requirements,
          header
            ? {
                settings: header.settings,
                requirements: await repository.requirements(header.id),
              }
            : undefined,
        );
        await this.stockItems.requireColors(
          input.requirements.map((item) => item.fabricColorId),
          tx,
        );
        const stock = await this.stockItems.findForAllocation(
          tx,
          stockIds
            ? { stockIds }
            : {
                colorIds: [
                  ...new Set(
                    input.requirements.map((item) => item.fabricColorId),
                  ),
                ],
              },
        );
        const reservations = await repository.reservations(
          stock.map((item) => item.id),
          input.allocationId,
        );
        return {
          context: buildCuttingContext(configured, stock, reservations),
          stock,
        };
      }, true),
    );
  }
}
