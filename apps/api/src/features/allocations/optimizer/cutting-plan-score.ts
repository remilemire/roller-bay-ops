import type { CuttingPlanSummary } from '../cutting-plan/cutting-plan.types.js';

/** Lexicographic stock policy, in the same order as the model objectives. */
export function cuttingPlanScore(summary: CuttingPlanSummary) {
  return [
    BigInt(summary.newRollCount),
    BigInt(summary.wasteAreaMm2.replace('.', '')),
    BigInt(summary.cutCount),
    BigInt(summary.stockItemCount),
  ] as const;
}
