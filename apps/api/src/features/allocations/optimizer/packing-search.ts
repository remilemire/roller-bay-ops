import { setImmediate } from 'node:timers/promises';
import { checkCancellation } from './optimization.errors.js';

export type Blind = { id: string; width: bigint; drop: bigint };
export type Stock = {
  id: string;
  width: bigint;
  length: bigint;
  opened: boolean;
  isRemnant: boolean;
};
export type Cut = {
  stock: Stock;
  drop: bigint;
  spare: bigint;
  blinds: Blind[];
};
type Placement = { cut: Cut } | { stock: Stock };
export type SearchCounts = { placements: number; backtracks: number };

export const compareDimensions = (a: bigint, b: bigint) =>
  a < b ? -1 : a > b ? 1 : 0;

// Drops are nonincreasing. Adding a blind to any existing cut therefore costs
// no roll length. Equal spare widths have identical future feasibility, even
// when searching for a fit among the supplied stock. Opening a new cut depends
// on usable width, remaining length and opening cost.
function* placements(
  blind: Blind,
  cuts: Cut[],
  stocks: Stock[],
  openingsLeft: number,
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
    if (
      (stock.opened || openingsLeft > 0) &&
      stock.width >= blind.width &&
      stock.length >= blind.drop
    ) {
      const key = `${stock.width}/${stock.length}/${stock.opened}`;
      if (!capacities.has(key)) {
        capacities.add(key);
        yield { stock };
        continue;
      }
    }
    yield null;
  }
}

// Sweep widest to narrowest to find the longest available stock for each
// width. Keep all copies since their quantities matter for remnant coverage.
export function fittingBlinds(blinds: Blind[], stocks: Stock[]) {
  const widest = [...stocks].sort((a, b) =>
    compareDimensions(b.width, a.width),
  );
  const demands = [...blinds].sort((a, b) =>
    compareDimensions(b.width, a.width),
  );
  let next = 0;
  let longest = 0n;
  return demands.filter((blind) => {
    while (next < widest.length && widest[next]!.width >= blind.width) {
      const length = widest[next++]!.length;
      if (length > longest) longest = length;
    }
    return blind.drop <= longest;
  });
}

type Frame = {
  choices: Generator<Placement | null>;
  undo?: () => void;
};

// The depth-first search stops at the first fit within this opening limit.
// A failed search restores every stock and cut before the next limit is tried.
export async function packWithinLimit(
  blinds: Blind[],
  eligible: Stock[],
  openingsLeft: number,
  slack: bigint,
  minimumWidth: bigint,
  minimumDrop: bigint,
  signal: AbortSignal | undefined,
  counts: SearchCounts,
) {
  // A successful probe keeps its cuts. Later probes need the original capacities.
  const stocks = eligible.map((stock) => ({ ...stock }));
  const widths = new Set(blinds.map((blind) => blind.width));
  const distinctWidths = [...widths];
  const cuts: Cut[] = [];
  const stack: Frame[] = [
    { choices: placements(blinds[0]!, cuts, stocks, openingsLeft) },
  ];
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
    const opensRoll = 'stock' in choice && !choice.stock.opened;
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
      if (opensRoll) {
        cut.stock.opened = true;
        openingsLeft--;
      }
    } else cut = choice.cut;
    slack -= loss;
    cut.spare -= blind.width;
    cut.blinds.push(blind);
    counts.placements++;
    if (stack.length === blinds.length) return cuts;
    stack.push({
      choices: placements(blinds[stack.length]!, cuts, stocks, openingsLeft),
      undo: () => {
        cut.blinds.pop();
        cut.spare += blind.width;
        slack += loss;
        if ('stock' in choice) {
          cut.stock.length += blind.drop;
          if (opensRoll) {
            cut.stock.opened = false;
            openingsLeft++;
          }
          cuts.pop();
        }
      },
    });
  }
  return null;
}
