import { setImmediate } from 'node:timers/promises';
import type {
  CuttingContext,
  CuttingPlan,
} from '@roller-bay/shared/allocations';
import {
  toLengthUnits,
  toMillimetres,
} from '../cutting-plan/cutting-dimensions.js';
import { validateCuttingPlan } from '../cutting-plan/cutting-plan.validator.js';
import {
  CuttingOptimizationError,
  checkCancellation,
} from './optimization.errors.js';
import { preferRemnants } from './remnant-allocation.js';
import {
  compareDimensions,
  fittingBlinds,
  packWithinLimit,
  type Blind,
  type Stock,
  type SearchCounts,
} from './packing-search.js';
import type { CuttingOptimizationResult } from './cutting-plan-optimizer.types.js';

async function packColor(
  blinds: Blind[],
  stocks: Stock[],
  signal: AbortSignal | undefined,
  counts: SearchCounts,
) {
  blinds.sort(
    (a, b) =>
      compareDimensions(b.drop, a.drop) ||
      compareDimensions(b.width, a.width) ||
      a.id.localeCompare(b.id),
  );
  const minimumWidth = blinds.reduce(
    (width, blind) => (blind.width < width ? blind.width : width),
    blinds[0]!.width,
  );
  const minimumDrop = blinds.at(-1)!.drop;
  const area = (s: Stock) => s.width * s.length;
  // Even the smallest blind consumes one width slot and one drop in a cut.
  const capacity = (s: Stock) =>
    (s.width / minimumWidth) * (s.length / minimumDrop);
  const usable = stocks.filter((s) => capacity(s) > 0n);
  const opened = usable
    .filter((s) => s.opened)
    .sort(
      (a, b) =>
        Number(b.isRemnant) - Number(a.isRemnant) ||
        compareDimensions(a.width, b.width) ||
        compareDimensions(a.length, b.length) ||
        a.id.localeCompare(b.id),
    );
  const sealed = usable
    .filter((s) => !s.opened)
    .sort(
      (a, b) =>
        compareDimensions(b.length, a.length) ||
        compareDimensions(b.width, a.width) ||
        a.id.localeCompare(b.id),
    );
  const areas = sealed.map(area).sort((a, b) => compareDimensions(b, a));
  const capacities = sealed
    .map(capacity)
    .sort((a, b) => compareDimensions(b, a));
  const demand = blinds.reduce((sum, b) => sum + b.width * b.drop, 0n);
  let slack = opened.reduce((sum, s) => sum + area(s), 0n) - demand;
  let slots = opened.reduce((sum, s) => sum + capacity(s), 0n);

  const maximum = Math.min(blinds.length, sealed.length);
  let narrowestOfLongest = sealed[0]?.width ?? 0n;
  for (let limit = 0; limit <= maximum; limit++) {
    checkCancellation(signal);
    if (limit > 0) {
      const width = sealed[limit - 1]!.width;
      if (width < narrowestOfLongest) narrowestOfLongest = width;
      slack += areas[limit - 1]!;
      slots += capacities[limit - 1]!;
    }
    // The largest k areas and capacities are independent upper bounds for
    // *any* k sealed rolls. Neither assumes that those exact rolls must be used.
    if (slack < 0n || slots < BigInt(blinds.length)) continue;
    await setImmediate();
    checkCancellation(signal);
    // Of sealed rolls with equal width, any k can be replaced by the k
    // longest. Actual selections (including narrower widths) still backtrack.
    const seen = new Map<bigint, number>();
    const eligible = [...opened];
    if (limit > 0) {
      for (const [index, stock] of sealed.entries()) {
        // If all k longest rolls are also as wide, one of them can take
        // this roll's entire layout in any plan that opens at most k.
        if (index >= limit && stock.width <= narrowestOfLongest) continue;
        const count = seen.get(stock.width) ?? 0;
        if (count < limit) {
          eligible.push(stock);
          seen.set(stock.width, count + 1);
        }
      }
    }
    if (fittingBlinds(blinds, eligible).length !== blinds.length) continue;
    const pack = (pieces: Blind[], items: Stock[], spareArea: bigint) =>
      packWithinLimit(
        pieces,
        items,
        limit,
        spareArea,
        minimumWidth,
        minimumDrop,
        signal,
        counts,
      );
    const first = await pack(blinds, eligible, slack);
    if (first)
      return preferRemnants(blinds, eligible, first, slack, pack, signal);
  }
  return null;
}

export async function findFeasiblePlan(
  context: CuttingContext,
  signal?: AbortSignal,
  counts: SearchCounts = { placements: 0, backtracks: 0 },
): Promise<CuttingOptimizationResult> {
  checkCancellation(signal);
  const colors = new Map<string, { blinds: Blind[]; stocks: Stock[] }>();
  for (const requirement of context.requirements) {
    const color = colors.get(requirement.fabricColorId) ?? {
      blinds: [],
      stocks: [],
    };
    const blind = {
      id: requirement.id,
      width: toLengthUnits(requirement.widthMm),
      drop:
        toLengthUnits(requirement.lengthMm) +
        toLengthUnits(requirement.lengthAllowanceMm),
    };
    for (let i = 0; i < requirement.quantity; i++) color.blinds.push(blind);
    colors.set(requirement.fabricColorId, color);
  }
  const trim = 2n * toLengthUnits(context.settings.edgeTrimMm);
  for (const stock of context.stockItems) {
    const color = colors.get(stock.fabricColorId);
    if (
      !color ||
      stock.consumedAt ||
      stock.voidedAt ||
      (stock.isRemnant && stock.reservedLengthMm > 0)
    )
      continue;
    const width = toLengthUnits(stock.widthMm) - trim;
    const length =
      toLengthUnits(stock.remainingLengthMm) -
      toLengthUnits(stock.reservedLengthMm);
    if (width > 0n && length > 0n)
      color.stocks.push({
        id: stock.id,
        width,
        length,
        opened: stock.isUsed || stock.isRemnant,
        isRemnant: stock.isRemnant,
      });
  }
  const plan: CuttingPlan = { cuts: [] };
  for (const { blinds, stocks } of colors.values()) {
    if (fittingBlinds(blinds, stocks).length !== blinds.length)
      return { status: 'infeasible' };
  }
  for (const { blinds, stocks } of colors.values()) {
    const cuts = await packColor(blinds, stocks, signal, counts);
    if (!cuts) return { status: 'infeasible' };
    for (const cut of cuts) {
      const quantities = new Map<string, number>();
      for (const blind of cut.blinds)
        quantities.set(blind.id, (quantities.get(blind.id) ?? 0) + 1);
      plan.cuts.push({
        stockItemId: cut.stock.id,
        lengthMm: toMillimetres(cut.drop),
        items: [...quantities].map(([requirementId, quantity]) => ({
          requirementId,
          quantity,
        })),
      });
    }
  }
  const validated = validateCuttingPlan(context, plan);
  if (!validated.valid)
    throw new CuttingOptimizationError(
      'invalid_solution',
      'The constructed cutting plan failed validation.',
      { cause: validated.issues },
    );
  return { status: 'feasible', plan, summary: validated.summary };
}
