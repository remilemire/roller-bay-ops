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
import type { CuttingOptimizationResult } from './cutting-plan-optimizer.types.js';

type Blind = { id: string; width: bigint; drop: bigint };
type Stock = { id: string; width: bigint; length: bigint; opened: boolean };
type Cut = { stock: Stock; drop: bigint; spare: bigint; blinds: Blind[] };
type Placement = { cut: Cut } | { stock: Stock };
export type SearchCounts = { placements: number; backtracks: number };

const compare = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);

// Drops are nonincreasing. Adding a blind to any existing cut therefore costs
// no roll length. Equal spare widths have identical future feasibility, even
// when the cuts belong to different rolls. Likewise opening a cut only depends
// on the roll's usable width and remaining length. Identity matters for scoring
// later, but exploring permutations of these choices cannot unlock a fit.
function* placements(
  blind: Blind,
  cuts: Cut[],
  stocks: Stock[],
): Generator<Placement | null> {
  const widths = new Set<bigint>();
  for (const cut of cuts) {
    if (cut.spare >= blind.width && !widths.has(cut.spare)) {
      widths.add(cut.spare);
      yield { cut };
    } else yield null;
  }
  const capacities = new Set<string>();
  for (const stock of stocks) {
    if (stock.width >= blind.width && stock.length >= blind.drop) {
      const key = `${stock.width}/${stock.length}`;
      if (!capacities.has(key)) {
        capacities.add(key);
        yield { stock };
        continue;
      }
    }
    yield null;
  }
}

// Check every color before spending time backtracking on any of them. Sweeping
// from widest to narrowest finds the longest eligible roll for each width.
function individuallyFits(blinds: Blind[], stocks: Stock[]) {
  const widest = [...stocks].sort((a, b) => compare(b.width, a.width));
  const demands = [...new Set(blinds)].sort((a, b) =>
    compare(b.width, a.width),
  );
  let next = 0;
  let longest = 0n;
  for (const blind of demands) {
    while (next < widest.length && widest[next]!.width >= blind.width) {
      const length = widest[next++]!.length;
      if (length > longest) longest = length;
    }
    if (blind.drop > longest) return false;
  }
  return true;
}

type Frame = {
  choices: Generator<Placement | null>;
  undo?: () => void;
};

// The first path is first-fit decreasing. If it gets stuck, the explicit stack
// resumes at the last untried placement. There is no search or pattern cutoff.
async function packColor(
  blinds: Blind[],
  stocks: Stock[],
  signal: AbortSignal | undefined,
  counts: SearchCounts,
) {
  blinds.sort(
    (a, b) =>
      compare(b.drop, a.drop) ||
      compare(b.width, a.width) ||
      a.id.localeCompare(b.id),
  );
  stocks.sort(
    (a, b) =>
      compare(a.width, b.width) ||
      Number(b.opened) - Number(a.opened) ||
      compare(a.length, b.length) ||
      a.id.localeCompare(b.id),
  );
  const minimumWidth = blinds.reduce(
    (width, blind) => (blind.width < width ? blind.width : width),
    blinds[0]!.width,
  );
  const minimumDrop = blinds.at(-1)!.drop;
  const widths = new Set(blinds.map((blind) => blind.width));
  const distinctWidths = [...widths];
  const cuts: Cut[] = [];
  let slack =
    stocks.reduce((sum, s) => sum + s.width * s.length, 0n) -
    blinds.reduce((sum, b) => sum + b.width * b.drop, 0n);
  if (slack < 0n) return null;
  const stack: Frame[] = [{ choices: placements(blinds[0]!, cuts, stocks) }];
  let steps = 0;
  while (stack.length) {
    // Count scanned alternatives too. Even a frame with no fits must yield.
    if (++steps % 2048 === 0) {
      await setImmediate();
      checkCancellation(signal);
    }
    const frame = stack.at(-1)!;
    const next = frame.choices.next();
    if (next.done) {
      stack.pop();
      frame.undo?.();
      counts.backtracks++;
      continue;
    }
    if (!next.value) continue;
    const blind = blinds[stack.length - 1]!;
    const choice = next.value;
    const newCut = 'stock' in choice;
    const drop = newCut ? blind.drop : choice.cut.drop;
    const spare =
      (newCut ? choice.stock.width : choice.cut.spare) - blind.width;
    let loss = blind.width * (drop - blind.drop);
    // A strip narrower than every blind, or a roll tail shorter than every
    // drop, can never carry another blind in this order. Charge it once.
    if (spare < minimumWidth) loss += spare * drop;
    if (newCut) {
      const tail = choice.stock.length - blind.drop;
      if (tail < minimumDrop) loss += tail * choice.stock.width;
    }
    if (loss > slack) continue;
    // An exact-fill strip that can hold at most two further blinds must
    // equal one requested width or the sum of a pair. Considering widths
    // already placed is a safe relaxation and keeps this check inexpensive.
    if (
      loss === slack &&
      spare >= minimumWidth &&
      spare < 3n * minimumWidth &&
      !widths.has(spare)
    ) {
      if (
        spare < 2n * minimumWidth ||
        !distinctWidths.some((width) => widths.has(spare - width))
      )
        continue;
    }
    let cut: Cut;
    if ('stock' in choice) {
      cut = {
        stock: choice.stock,
        drop: blind.drop,
        spare: choice.stock.width,
        blinds: [],
      };
      cuts.push(cut);
      cut.stock.length -= blind.drop;
    } else cut = choice.cut;
    slack -= loss;
    cut.spare -= blind.width;
    cut.blinds.push(blind);
    counts.placements++;
    if (stack.length === blinds.length) return cuts;
    stack.push({
      choices: placements(blinds[stack.length]!, cuts, stocks),
      undo: () => {
        cut.blinds.pop();
        cut.spare += blind.width;
        slack += loss;
        if ('stock' in choice) {
          cut.stock.length += blind.drop;
          cuts.pop();
        }
      },
    });
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
      });
  }
  const plan: CuttingPlan = { cuts: [] };
  for (const { blinds, stocks } of colors.values()) {
    if (!individuallyFits(blinds, stocks)) return { status: 'infeasible' };
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
