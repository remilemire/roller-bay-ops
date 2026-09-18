/**
 * Coordinates resolution, rule checks, and accounting in that order.
 * Unresolved or invalid plans never reach summary calculation.
 */
import type { CuttingPlanValidation } from './cutting-plan.types.js';
import { resolveCuttingPlan } from './plan.resolution.js';
import { validateRequirements } from './requirement.validation.js';
import { validateCuts } from './cut.validation.js';
import { validateStockUsage } from './stock-usage.validation.js';
import { buildSummary } from './cutting-plan.accounting.js';
export type {
  CuttingPlanIssue,
  CuttingLeftover,
  CuttingPlanSummary,
  CuttingPlanValidation,
} from './cutting-plan.types.js';

export function validateCuttingPlan(
  contextInput: unknown,
  planInput: unknown,
): CuttingPlanValidation {
  const resolved = resolveCuttingPlan(contextInput, planInput);
  if (!resolved.valid) return resolved;
  const issues = [
    ...validateRequirements(resolved.plan),
    ...validateCuts(resolved.plan),
    ...validateStockUsage(resolved.plan),
  ];
  if (issues.length) return { valid: false, issues };
  return { valid: true, summary: buildSummary(resolved.plan) };
}
