import {
  BadRequestException,
  ConflictException,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { StockItem } from '@roller-bay/shared/stock-items';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import 'reflect-metadata';
import { z } from 'zod';
import { SolverError } from '../../solver/solver.errors.js';
import { stubUnitOfWork } from '../../testing/unit-of-work.js';
import type { StockItemsService } from '../stock-items/index.js';
import type { WorkOrdersService } from '../work-orders/index.js';
import { AllocationPlanningService } from './allocation-planning.service.js';
import { CuttingRulesService } from './cutting-rules.service.js';
import type { CuttingPlanOptimizer } from './optimizer/cutting-plan-optimizer.js';
import { CuttingOptimizationError } from './optimizer/optimization.errors.js';
import {
  parseOptimizationContext,
  parseOptimizationOptions,
} from './optimizer/optimization.input.js';
import { fixture } from './optimizer/optimizer.fixtures.js';

/** Runs a preview whose snapshot succeeds and whose optimizer throws `failure`. */
function optimizeWith(failure: unknown) {
  const context = fixture();
  const unitOfWork = stubUnitOfWork({
    allocations: { reservations: async () => new Map() },
  });
  const stockItems = {
    requireColors: async () => undefined,
    findForAllocation: async () => context.stockItems as unknown as StockItem[],
  } as unknown as StockItemsService;
  const optimizer = {
    optimize: async () => {
      throw failure;
    },
  } as unknown as CuttingPlanOptimizer;
  // The blinds planned are the work order's saved lines.
  const orders = {
    lines: async () => ({
      lines: context.requirements.map((item, index) => ({
        ...item,
        position: index + 1,
        widthMm: String(item.widthMm),
        lengthMm: String(item.lengthMm),
      })),
    }),
  } as unknown as WorkOrdersService;
  return new AllocationPlanningService(
    unitOfWork,
    stockItems,
    optimizer,
    new CuttingRulesService(
      new ConfigService({
        CUTTING_EDGE_TRIM_MM: 1,
        CUTTING_MINIMUM_REMNANT_WIDTH_MM: 100,
        CUTTING_MINIMUM_REMNANT_LENGTH_MM: 100,
        CUTTING_DROP_ALLOWANCE_MM: 0,
      }),
    ),
    orders,
  ).optimize({ workOrderId: randomUUID(), maxTimeSeconds: 5 });
}

function expectHttp<T extends HttpException>(
  type: new (...args: never[]) => T,
  message: string,
  cause: unknown,
) {
  return (error: unknown) => {
    assert.ok(error instanceof type, `expected ${type.name}`);
    assert.equal(error.message, message);
    assert.equal(error.cause, cause);
    return true;
  };
}

test('optimizer schema failures carry curated messages and keep the Zod detail in the cause', () => {
  assert.throws(
    () => parseOptimizationOptions({ maxTimeSeconds: 61 }),
    (error: unknown) => {
      assert.ok(error instanceof CuttingOptimizationError);
      assert.equal(error.code, 'invalid_options');
      assert.doesNotMatch(error.message, /expected|maxTimeSeconds|"code"/);
      assert.ok(error.cause instanceof z.ZodError);
      return true;
    },
  );
  assert.throws(
    () => parseOptimizationContext({ ...fixture(), requirements: [] }),
    (error: unknown) => {
      assert.ok(error instanceof CuttingOptimizationError);
      assert.equal(error.code, 'invalid_context');
      assert.doesNotMatch(error.message, /expected|requirements|"code"/);
      assert.ok(error.cause instanceof z.ZodError);
      return true;
    },
  );
});

test('previews expose order-level failures and busy or cancelled solves with their cause attached', async () => {
  const tooMany = new CuttingOptimizationError(
    'invalid_input',
    'Orders support at most 100 individual blinds.',
  );
  await assert.rejects(
    optimizeWith(tooMany),
    expectHttp(BadRequestException, tooMany.message, tooMany),
  );
  const range = new CuttingOptimizationError(
    'numeric_range',
    'Cutting values exceed the supported numeric range.',
  );
  await assert.rejects(
    optimizeWith(range),
    expectHttp(BadRequestException, range.message, range),
  );
  const busy = new SolverError('busy', 'Solver service is busy.');
  await assert.rejects(
    optimizeWith(busy),
    expectHttp(
      ConflictException,
      'The optimizer is busy; try again shortly.',
      busy,
    ),
  );
  const cancelled = new SolverError('cancelled', 'Solve cancelled.');
  await assert.rejects(
    optimizeWith(cancelled),
    expectHttp(ConflictException, 'Optimization cancelled.', cancelled),
  );
});

test('internal optimizer, model, and transport faults become a generic 503 whose cause is preserved for the log', async () => {
  for (const failure of [
    new CuttingOptimizationError(
      'invalid_options',
      'Optimization options are invalid.',
      { cause: new Error('secret schema detail') },
    ),
    new CuttingOptimizationError(
      'invalid_context',
      'Optimization context is invalid.',
      { cause: new Error('secret schema detail') },
    ),
    new CuttingOptimizationError('invalid_model', 'secret model detail'),
    new CuttingOptimizationError('invalid_solution', 'secret solution detail'),
    new SolverError('unavailable', 'Could not reach the Solver service.', {
      cause: new Error('connect ECONNREFUSED secret-host:8001'),
    }),
    new Error('connect ECONNREFUSED secret-host:5432'),
  ])
    await assert.rejects(optimizeWith(failure), (error: unknown) => {
      assert.ok(error instanceof ServiceUnavailableException);
      assert.equal(error.message, 'Optimization is unavailable.');
      assert.doesNotMatch(error.message, /secret/);
      assert.equal(error.cause, failure);
      return true;
    });
});
