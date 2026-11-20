import type {
  CuttingContext,
  CuttingPlan,
} from '@roller-bay/shared/allocations';
import type { ValidatedCuttingPlan } from './cutting-plan-optimizer.types.js';

export function remnantBlindCount(context: CuttingContext, plan: CuttingPlan) {
  const ids = new Set(
    context.stockItems
      .filter((stock) => stock.isRemnant)
      .map((stock) => stock.id),
  );
  let blinds = 0;
  for (const cut of plan.cuts) {
    if (ids.has(cut.stockItemId))
      for (const item of cut.items) blinds += item.quantity;
  }
  return blinds;
}

/** Lexicographic stock policy, in the same order as the model objectives. */
export function cuttingPlanScore(
  context: CuttingContext,
  { summary, plan }: ValidatedCuttingPlan,
) {
  return [
    BigInt(summary.newRollCount),
    -BigInt(remnantBlindCount(context, plan)),
    BigInt(summary.wasteAreaMm2.replace('.', '')),
    BigInt(summary.cutCount),
    BigInt(summary.stockItemCount),
  ] as const;
}
