/**
 * Checks that selected stock is usable and aggregate cuts fit available lengths.
 * Returns issues only. Reservation amounts and remnant tails belong to accounting.
 */
import type {
  CuttingPlanIssue,
  ResolvedCuttingPlan,
} from './cutting-plan.types.js';
import { toLengthUnits } from './cutting-dimensions.js';

export function validateStockUsage(
  plan: ResolvedCuttingPlan,
): CuttingPlanIssue[] {
  const issues: CuttingPlanIssue[] = [];
  for (const cut of plan.cuts) {
    const path = `plan.cuts.${cut.index}`;
    if (cut.stock.voidedAt)
      issues.push({
        code: 'voided_stock',
        path,
        message: 'Voided stock cannot be used.',
      });
    if (cut.stock.consumedAt !== null)
      issues.push({
        code: 'consumed_stock',
        path,
        message: 'Consumed stock cannot be used.',
      });
    if (cut.stock.isRemnant && cut.stock.reservedLengthMm > 0)
      issues.push({
        code: 'reserved_remnant',
        path,
        message: 'An already reserved remnant cannot be used.',
      });
  }
  for (const { stock, plannedLength } of plan.stockUsage) {
    const available =
      toLengthUnits(stock.remainingLengthMm) -
      toLengthUnits(stock.reservedLengthMm);
    if (plannedLength > available)
      issues.push({
        code: 'length_capacity',
        path: `context.stockItems.${stock.id}`,
        message: 'Planned cuts exceed available stock length.',
      });
  }
  return issues;
}
