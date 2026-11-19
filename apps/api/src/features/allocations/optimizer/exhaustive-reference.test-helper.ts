import assert from 'node:assert/strict';
import type {
  CuttingContext,
  CuttingPlan,
} from '@roller-bay/shared/allocations';
import type { CuttingPlanSummary } from '../cutting-plan/cutting-plan.types.js';
import { validateCuttingPlan } from '../cutting-plan/cutting-plan.validator.js';
import {
  toLengthUnits,
  toMillimetres,
} from '../cutting-plan/cutting-dimensions.js';
export const score = (summary: CuttingPlanSummary) => [
  BigInt(summary.wasteAreaMm2.replace('.', '')),
  BigInt(summary.newRollCount),
  BigInt(summary.cutCount),
  BigInt(summary.stockItemCount),
];
const better = (a: bigint[], b: bigint[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! < b[i]!;
  return false;
};

// Independently partitions individual blinds into cuts, tries all stock choices,
// and scores only complete plans through the domain validator (no pattern/model reuse).
export function exhaustiveReference(context: CuttingContext): bigint[] | null {
  const blinds = context.requirements.flatMap((item) =>
    Array.from({ length: item.quantity }, () => item),
  );
  assert.ok(blinds.length <= 5);
  let best: bigint[] | null = null;
  const cuts: CuttingPlan['cuts'] = [];
  const consumed = new Map<string, bigint>();
  const trim = toLengthUnits(context.settings.edgeTrimMm);
  function visit(mask: number): void {
    if (mask === 0) {
      const result = validateCuttingPlan(context, { cuts });
      if (result.valid) {
        const value = score(result.summary);
        if (!best || better(value, best)) best = value;
      }
      return;
    }
    const first = mask & -mask;
    for (let subset = mask; subset; subset = (subset - 1) & mask) {
      if (!(subset & first)) continue;
      const selected = blinds.filter((_, index) => subset & (1 << index));
      const color = selected[0]!.fabricColorId;
      if (selected.some((item) => item.fabricColorId !== color)) continue;
      const width = selected.reduce(
        (sum, item) => sum + toLengthUnits(item.widthMm),
        0n,
      );
      const length = selected.reduce((max, item) => {
        const value =
          toLengthUnits(item.lengthMm) + toLengthUnits(item.lengthAllowanceMm);
        return value > max ? value : max;
      }, 0n);
      const quantities = new Map<string, number>();
      for (const item of selected)
        quantities.set(item.id, (quantities.get(item.id) ?? 0) + 1);
      for (const stock of context.stockItems) {
        if (
          stock.fabricColorId !== color ||
          stock.consumedAt !== null ||
          (stock.isRemnant && stock.reservedLengthMm > 0) ||
          width + 2n * trim > toLengthUnits(stock.widthMm)
        )
          continue;
        const used = consumed.get(stock.id) ?? 0n;
        if (
          used + length >
          toLengthUnits(stock.remainingLengthMm) -
            toLengthUnits(stock.reservedLengthMm)
        )
          continue;
        consumed.set(stock.id, used + length);
        cuts.push({
          stockItemId: stock.id,
          lengthMm: toMillimetres(length),
          items: [...quantities].map(([requirementId, quantity]) => ({
            requirementId,
            quantity,
          })),
        });
        visit(mask ^ subset);
        cuts.pop();
        consumed.set(stock.id, used);
      }
    }
  }
  visit((1 << blinds.length) - 1);
  return best;
}
