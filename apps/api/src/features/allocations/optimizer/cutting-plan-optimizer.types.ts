import type { CuttingPlan } from '@roller-bay/shared/allocations';
import type { CuttingPlanSummary } from '../cutting-plan/cutting-plan.types.js';

export interface CuttingOptimizationOptions {
  maxTimeSeconds?: number;
  signal?: AbortSignal;
}

export type CuttingOptimizationResult =
  | { status: 'feasible'; plan: CuttingPlan; summary: CuttingPlanSummary }
  | { status: 'infeasible' }
  | { status: 'unknown'; reason: 'search_limit' | 'model_limit' };
