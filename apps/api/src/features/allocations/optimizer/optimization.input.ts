import {
  cuttingContextSchema,
  type CuttingContext,
} from '@roller-bay/shared/allocations';
import { z } from 'zod';
import { toLengthUnits } from '../cutting-plan/cutting-dimensions.js';
import { CuttingOptimizationError } from './optimization.errors.js';
import type { CuttingOptimizationOptions } from './cutting-plan-optimizer.types.js';

export const OPTIMIZATION_LIMITS = Object.freeze({
  blinds: 100,
  patterns: 2000,
  nodes: 100000,
  assignments: 6000,
});

const optionsSchema = z.strictObject({
  maxTimeSeconds: z.number().positive().max(60).default(5),
  signal: z.instanceof(AbortSignal).optional(),
});

export function parseOptimizationOptions(options: CuttingOptimizationOptions) {
  const result = optionsSchema.safeParse(options);
  // Options come from server code (the controller already bounds maxTimeSeconds),
  // so a schema failure is a fault to log, not text to show.
  if (!result.success)
    throw new CuttingOptimizationError(
      'invalid_options',
      'Optimization options are invalid.',
      { cause: result.error },
    );
  return result.data;
}

export function parseOptimizationContext(
  input: CuttingContext,
): CuttingContext {
  const result = cuttingContextSchema.safeParse(input);
  // The context is assembled by the server from validated input and stock rows;
  // a schema failure here is an internal inconsistency, unlike the order-level
  // checks below whose messages are meant for the requester.
  if (!result.success)
    throw new CuttingOptimizationError(
      'invalid_context',
      'Optimization context is invalid.',
      { cause: result.error },
    );
  const context = result.data;
  if (
    context.requirements.reduce((sum, item) => sum + item.quantity, 0) >
    OPTIMIZATION_LIMITS.blinds
  )
    throw new CuttingOptimizationError(
      'invalid_input',
      'Orders support at most 100 individual blinds.',
    );
  for (const items of [context.requirements, context.stockItems])
    if (new Set(items.map((item) => item.id)).size !== items.length)
      throw new CuttingOptimizationError(
        'invalid_input',
        'Requirement and stock IDs must be unique within their collections.',
      );
  if (
    context.stockItems.some(
      (item) =>
        toLengthUnits(item.reservedLengthMm) >
        toLengthUnits(item.remainingLengthMm),
    )
  )
    throw new CuttingOptimizationError(
      'invalid_input',
      'Stock reservations exceed remaining length.',
    );
  context.requirements.sort((a, b) => a.id.localeCompare(b.id));
  context.stockItems.sort((a, b) => a.id.localeCompare(b.id));
  return context;
}
