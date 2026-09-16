/**
 * Enumerates legal single-drop patterns under per-color budgets. Width groups
 * take turns, so one width cannot consume an entire color's candidate budget.
 * Completeness records whether every legal pattern and stock assignment was kept.
 */
import { setImmediate } from 'node:timers/promises';
import type { CuttingContext } from '@roller-bay/shared/allocations';
import type {
  ResolvedAssignment,
  Stock,
} from '../cutting-plan/cutting-plan.types.js';
import { toLengthUnits } from '../cutting-plan/cutting-dimensions.js';
import {
  dropOffcuts,
  isReusableOffcut,
} from '../cutting-plan/cutting-offcuts.js';
import { checkCancellation } from './optimization.errors.js';
import { OPTIMIZATION_LIMITS } from './optimization.input.js';

export interface DropPattern {
  colorId: string;
  width: bigint;
  length: bigint;
  items: ResolvedAssignment[];
  waste: bigint;
}

export interface PatternAssignment {
  pattern: DropPattern;
  stock: Stock;
  maximum: number;
}

export interface PatternCandidates {
  assignments: PatternAssignment[];
  complete: boolean;
  impossible: boolean;
}

interface WidthGroup {
  colorId: string;
  width: bigint;
  stocks: Stock[];
  items: ResolvedAssignment[];
}

export interface CandidateLimits {
  patterns: number;
  nodes: number;
  assignments: number;
}

const availableLength = (stock: Stock) =>
  toLengthUnits(stock.remainingLengthMm) -
  toLengthUnits(stock.reservedLengthMm);

function* combinations(
  group: WidthGroup,
  trim: bigint,
): Generator<ResolvedAssignment[] | null> {
  const capacity = group.width - 2n * trim;
  const items = group.items;
  for (const item of items) yield [{ ...item, quantity: 1 }];
  // A greedy pattern from each possible leading requirement provides diverse seeds.
  for (const first of items) {
    let remaining = capacity - first.width;
    const counts = new Map([[first.requirement.id, 1]]);
    for (const item of items) {
      const used = counts.get(item.requirement.id) ?? 0;
      const quantity = Math.min(
        item.requirement.quantity - used,
        Number(remaining / item.width),
      );
      if (quantity > 0) {
        counts.set(item.requirement.id, used + quantity);
        remaining -= item.width * BigInt(quantity);
      }
    }
    yield items
      .filter((item) => counts.has(item.requirement.id))
      .map((item) => ({ ...item, quantity: counts.get(item.requirement.id)! }));
  }
  const selected: ResolvedAssignment[] = [];
  function* visit(
    index: number,
    remaining: bigint,
  ): Generator<ResolvedAssignment[] | null> {
    // Each visited node is observable, including branches that produce no pattern.
    yield null;
    if (index === items.length) {
      if (selected.length) yield [...selected];
      return;
    }
    const item = items[index]!;
    const maximum = Math.min(
      item.requirement.quantity,
      Number(remaining / item.width),
    );
    for (let quantity = maximum; quantity >= 0; quantity--) {
      if (quantity) selected.push({ ...item, quantity });
      yield* visit(index + 1, remaining - item.width * BigInt(quantity));
      if (quantity) selected.pop();
    }
  }
  yield* visit(0, capacity);
}

function scorePattern(
  group: WidthGroup,
  items: ResolvedAssignment[],
  context: CuttingContext,
): DropPattern {
  const length = items.reduce(
    (max, item) => (item.length > max ? item.length : max),
    0n,
  );
  const waste = dropOffcuts(
    group.width,
    length,
    items,
    toLengthUnits(context.settings.edgeTrimMm),
  )
    .filter(
      (offcut) =>
        !isReusableOffcut(
          offcut.width,
          offcut.length,
          toLengthUnits(context.settings.minimumRemnantWidthMm),
          toLengthUnits(context.settings.minimumRemnantLengthMm),
        ),
    )
    .reduce(
      (sum, offcut) =>
        sum + offcut.width * offcut.length * BigInt(offcut.quantity),
      0n,
    );
  return { colorId: group.colorId, width: group.width, length, items, waste };
}

function* placements(
  pattern: DropPattern,
  stocks: Stock[],
): Generator<PatternAssignment> {
  for (const stock of stocks) {
    const maximum = Math.min(
      Number(availableLength(stock) / pattern.length),
      ...pattern.items.map((item) =>
        Math.floor(item.requirement.quantity / item.quantity),
      ),
    );
    if (maximum > 0) yield { pattern, stock, maximum };
  }
}

const share = (budget: number, count: number, index: number) =>
  Math.floor(budget / count) + (index < budget % count ? 1 : 0);

export async function generatePatterns(
  context: CuttingContext,
  signal?: AbortSignal,
  limits: CandidateLimits = OPTIMIZATION_LIMITS,
): Promise<PatternCandidates> {
  checkCancellation(signal);
  const trim = toLengthUnits(context.settings.edgeTrimMm);
  const groups = new Map<string, WidthGroup>();
  const requirements = new Map<string, ResolvedAssignment[]>();
  for (const requirement of context.requirements) {
    const list = requirements.get(requirement.fabricColorId) ?? [];
    list.push({
      requirement,
      quantity: 1,
      width: toLengthUnits(requirement.widthMm),
      length:
        toLengthUnits(requirement.lengthMm) +
        toLengthUnits(requirement.lengthAllowanceMm),
    });
    requirements.set(requirement.fabricColorId, list);
  }
  const covered = new Set<string>();
  let preparationSteps = 0;
  for (const stock of context.stockItems) {
    if (++preparationSteps % 128 === 0) {
      // Abort events cannot be observed while this CPU work monopolizes the event loop.
      await setImmediate();
      checkCancellation(signal);
    }
    if (
      stock.consumedAt !== null ||
      (stock.isRemnant && stock.reservedLengthMm > 0)
    )
      continue;
    const width = toLengthUnits(stock.widthMm);
    const available = availableLength(stock);
    const fitting = (requirements.get(stock.fabricColorId) ?? []).filter(
      (item) => item.width + 2n * trim <= width && item.length <= available,
    );
    if (!fitting.length) continue;
    for (const item of fitting) covered.add(item.requirement.id);
    const key = `${stock.fabricColorId}:${width}`;
    const group = groups.get(key) ?? {
      colorId: stock.fabricColorId,
      width,
      stocks: [],
      items: [],
    };
    group.stocks.push(stock);
    const ids = new Set(group.items.map((item) => item.requirement.id));
    group.items.push(
      ...fitting.filter((item) => !ids.has(item.requirement.id)),
    );
    groups.set(key, group);
  }
  // This check precedes candidate truncation: a blind that fits no available
  // piece by itself cannot fit inside any combined drop either.
  if (covered.size !== context.requirements.length)
    return { assignments: [], complete: true, impossible: true };
  const colors = [...requirements.keys()].sort();
  const assignments: PatternAssignment[] = [];
  let complete = true;
  let steps = 0;
  for (const [colorIndex, color] of colors.entries()) {
    const colorGroups = [...groups.values()]
      .filter((group) => group.colorId === color)
      .sort((a, b) => (a.width < b.width ? -1 : a.width > b.width ? 1 : 0));
    for (const group of colorGroups) {
      group.items.sort((a, b) =>
        a.length !== b.length
          ? a.length > b.length
            ? -1
            : 1
          : a.width !== b.width
            ? a.width > b.width
              ? -1
              : 1
            : a.requirement.id.localeCompare(b.requirement.id),
      );
      group.stocks.sort(
        (a, b) =>
          Number(b.isRemnant) - Number(a.isRemnant) ||
          Number(b.isUsed) - Number(a.isUsed) ||
          a.id.localeCompare(b.id),
      );
    }
    const patternBudget = share(limits.patterns, colors.length, colorIndex);
    const nodeBudget = share(limits.nodes, colors.length, colorIndex);
    const assignmentBudget = share(
      limits.assignments,
      colors.length,
      colorIndex,
    );
    let generators = colorGroups.map((group) => ({
      group,
      iterator: combinations(group, trim),
    }));
    const seen = new Set<string>();
    const patterns: { pattern: DropPattern; stocks: Stock[] }[] = [];
    let nodes = 0;
    generation: while (generators.length) {
      const next: typeof generators = [];
      for (const entry of generators) {
        if (nodes >= nodeBudget || patterns.length >= patternBudget) {
          complete = false;
          break generation;
        }
        nodes++;
        if (++steps % 128 === 0) {
          await setImmediate();
          checkCancellation(signal);
        }
        const result = entry.iterator.next();
        if (result.done) continue;
        next.push(entry);
        if (!result.value) continue;
        const key = `${entry.group.width}:${result.value.map((item) => `${item.requirement.id}=${item.quantity}`).join(',')}`;
        if (seen.has(key)) continue;
        seen.add(key);
        patterns.push({
          pattern: scorePattern(entry.group, result.value, context),
          stocks: entry.group.stocks,
        });
      }
      generators = next;
    }
    // Each pattern gets a stock candidate before any pattern gets a second one.
    let placementIterators = patterns.map(({ pattern, stocks }) =>
      placements(pattern, stocks),
    );
    let count = 0;
    placement: while (placementIterators.length) {
      const next: typeof placementIterators = [];
      for (const iterator of placementIterators) {
        if (++steps % 128 === 0) {
          await setImmediate();
          checkCancellation(signal);
        }
        const result = iterator.next();
        if (result.done) continue;
        if (count >= assignmentBudget) {
          complete = false;
          break placement;
        }
        assignments.push(result.value);
        count++;
        next.push(iterator);
      }
      placementIterators = next;
    }
  }
  checkCancellation(signal);
  return { assignments, complete, impossible: false };
}
