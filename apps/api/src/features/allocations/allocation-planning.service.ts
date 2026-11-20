/**
 * Preview snapshots are read consistently, then released before solver work.
 * They reserve nothing; confirmation must revalidate availability under stock locks.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  allocationPlanningResultSchema,
  allocationValidationSchema,
  type OptimizeAllocation,
  type AllocationPlanningResult,
  type CuttingContext,
  type ValidateAllocation,
} from '@roller-bay/shared/allocations';
import { UnitOfWork } from '../../unit-of-work/unit-of-work.js';
import type { StockItem } from '@roller-bay/shared/stock-items';
import { SolverError } from '../../solver/solver.errors.js';
import { StockItemsService } from '../stock-items/index.js';
import { buildCuttingContext } from './allocation-cutting-context.js';
import { requirePlanningRevision } from './allocation.rules.js';
import { allocationOperation } from './allocations.operation.js';
import { validateCuttingPlan } from './cutting-plan/cutting-plan.validator.js';
import {
  CuttingRulesService,
  planCutLengths,
} from './cutting-rules.service.js';
import { CuttingPlanOptimizer } from './optimizer/cutting-plan-optimizer.js';
import { CuttingOptimizationError } from './optimizer/optimization.errors.js';
export interface PlanningSnapshot {
  context: CuttingContext;
  stock: StockItem[];
  maxTimeSeconds?: number;
}

@Injectable()
export class AllocationPlanningService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly stockItems: StockItemsService,
    private readonly optimizer: CuttingPlanOptimizer,
    private readonly cuttingRules: CuttingRulesService,
  ) {}
  async prepare(input: OptimizeAllocation): Promise<PlanningSnapshot> {
    const snapshot = await this.snapshot(input);
    // Over-reserved stock is unavailable, not malformed user input. Replanning
    // excludes this allocation's own reservation before applying this filter.
    snapshot.context.stockItems = snapshot.context.stockItems.filter(
      (item) => item.reservedLengthMm <= item.remainingLengthMm,
    );
    try {
      return {
        ...snapshot,
        context: this.optimizer.prepare(snapshot.context),
        maxTimeSeconds: input.maxTimeSeconds,
      };
    } catch (error) {
      if (
        error instanceof CuttingOptimizationError &&
        error.code === 'invalid_input'
      )
        throw new BadRequestException(error.message, { cause: error });
      throw error;
    }
  }
  async solve(
    snapshot: PlanningSnapshot,
    signal?: AbortSignal,
    onFeasible?: (result: AllocationPlanningResult) => Promise<void>,
  ) {
    const present = (
      result: Awaited<ReturnType<CuttingPlanOptimizer['optimize']>>,
    ) => {
      const ids = new Set(
        result.status === 'feasible'
          ? result.plan.cuts.map((cut) => cut.stockItemId)
          : [],
      );
      return allocationPlanningResultSchema.parse({
        ...result,
        stockItems: snapshot.stock.filter((stock) => ids.has(stock.id)),
      });
    };
    try {
      const result = await this.optimizer.optimize(
        snapshot.context,
        { maxTimeSeconds: snapshot.maxTimeSeconds, signal },
        onFeasible && ((result) => onFeasible(present(result))),
      );
      return present(result);
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
      this.unitOfWork.readOnlyTransaction(async (context) => {
        const header = input.allocationId
          ? requirePlanningRevision(
              await context.allocations.findById(input.allocationId),
              input.expectedRevision,
            )
          : undefined;
        // The form's blinds, as they would be confirmed.
        const { requirements } = input;
        const configured = this.cuttingRules.apply(
          requirements,
          header?.settings,
        );
        const stock = await this.stockItems.findForAllocation(
          context,
          stockIds
            ? { stockIds }
            : {
                colorIds: [
                  ...new Set(requirements.map((item) => item.fabricColorId)),
                ],
              },
        );
        const reservations = await context.allocations.reservations(
          stock.map((item) => item.id),
          input.allocationId,
        );
        return {
          context: buildCuttingContext(configured, stock, reservations),
          stock,
        };
      }),
    );
  }
}
