/**
 * Parses inputs and replaces stock/requirement IDs with resolved references.
 * Produces a complete plan with exact dimensions, or reference/schema issues.
 * No cutting rules, reservations, or waste classification are applied here.
 */
import {
  cuttingContextSchema,
  cuttingPlanSchema,
  type CuttingContext,
  type CuttingPlan,
} from '@roller-bay/shared/allocations';
import type {
  CuttingPlanIssue,
  CuttingPlanResolution,
  PlannedStockUsage,
  ResolvedDrop,
  ResolvedAssignment,
} from './cutting-plan.types.js';
import { toLengthUnits } from './cutting-dimensions.js';

type ParsedInputs =
  | { valid: false; issues: CuttingPlanIssue[] }
  | { valid: true; context: CuttingContext; plan: CuttingPlan };

function parseInputs(contextInput: unknown, planInput: unknown): ParsedInputs {
  const context = cuttingContextSchema.safeParse(contextInput);
  const plan = cuttingPlanSchema.safeParse(planInput);
  const issues: CuttingPlanIssue[] = [];
  for (const [root, result] of [
    ['context', context],
    ['plan', plan],
  ] as const) {
    if (!result.success)
      for (const issue of result.error.issues) {
        issues.push({
          code: 'invalid_input',
          path: [root, ...issue.path].join('.'),
          message: issue.message,
        });
      }
  }
  if (!context.success || !plan.success) return { valid: false, issues };
  return { valid: true, context: context.data, plan: plan.data };
}

function groupStockUsage(drops: readonly ResolvedDrop[]): PlannedStockUsage[] {
  const usage = new Map<string, PlannedStockUsage>();
  for (const drop of drops) {
    const plannedLength =
      (usage.get(drop.stock.id)?.plannedLength ?? 0n) + drop.length;
    usage.set(drop.stock.id, { stock: drop.stock, plannedLength });
  }
  return [...usage.values()];
}

export function resolveCuttingPlan(
  contextInput: unknown,
  planInput: unknown,
): CuttingPlanResolution {
  const parsed = parseInputs(contextInput, planInput);
  if (!parsed.valid) return parsed;
  const { context, plan } = parsed;
  const issues: CuttingPlanIssue[] = [];
  const requirements = new Map(
    context.requirements.map((item) => [item.id, item]),
  );
  const stocks = new Map(context.stockItems.map((item) => [item.id, item]));
  if (requirements.size !== context.requirements.length)
    issues.push({
      code: 'duplicate_id',
      path: 'context.requirements',
      message: 'Requirement IDs must be unique.',
    });
  if (stocks.size !== context.stockItems.length)
    issues.push({
      code: 'duplicate_id',
      path: 'context.stockItems',
      message: 'Stock IDs must be unique.',
    });
  if (issues.length) return { valid: false, issues };

  const drops: ResolvedDrop[] = [];
  for (const [index, drop] of plan.drops.entries()) {
    const path = `plan.drops.${index}`;
    const stock = stocks.get(drop.stockItemId);
    if (!stock)
      issues.push({
        code: 'unknown_stock',
        path,
        message: 'Stock item is absent from the availability snapshot.',
      });
    const assignments: ResolvedAssignment[] = [];
    for (const [itemIndex, item] of drop.items.entries()) {
      const requirement = requirements.get(item.requirementId);
      if (!requirement) {
        issues.push({
          code: 'unknown_requirement',
          path: `${path}.items.${itemIndex}`,
          message: 'Requirement does not exist.',
        });
        continue;
      }
      assignments.push({
        requirement,
        quantity: item.quantity,
        width: toLengthUnits(requirement.widthMm),
        length:
          toLengthUnits(requirement.lengthMm) +
          toLengthUnits(requirement.lengthAllowanceMm),
      });
    }
    if (stock)
      drops.push({
        index,
        stock,
        length: toLengthUnits(drop.lengthMm),
        assignments,
      });
  }
  if (issues.length) return { valid: false, issues };
  return {
    valid: true,
    plan: {
      requirements: context.requirements,
      settings: context.settings,
      drops,
      stockUsage: groupStockUsage(drops),
    },
  };
}
