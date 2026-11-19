import type { CuttingPlan } from '@roller-bay/shared/allocations';
import type { CuttingPlanSummary } from '../cutting-plan/cutting-plan.types.js';

export interface CuttingOptimizationOptions {
  maxTimeSeconds?: number;
  signal?: AbortSignal;
}

export type ValidatedCuttingPlan = {
  status: 'feasible';
  plan: CuttingPlan;
  summary: CuttingPlanSummary;
};
export type CuttingOptimizationResult =
  ValidatedCuttingPlan | { status: 'infeasible' };
export type BoundedOptimizationResult =
  | CuttingOptimizationResult
  | { status: 'unknown'; reason: 'search_limit' | 'model_limit' };
