/**
 * Calculates reservations, physical offcuts, and area totals for a validated plan.
 * Geometry uses integer 0.001 mm units; only public dimensions convert back to mm.
 */
import type {
  CuttingLeftover,
  CuttingPlanSummary,
  ResolvedCuttingPlan,
} from './cutting-plan.types.js';
import { dropOffcuts, isReusableOffcut } from './cutting-offcuts.js';
import {
  toLengthUnits,
  toMillimetres,
  toSquareMillimetres,
} from './cutting-dimensions.js';

interface Offcut {
  stockItemId: string;
  dropIndex: number | null;
  kind: CuttingLeftover['kind'];
  width: bigint;
  length: bigint;
  quantity: number;
}

interface ClassifiedOffcut extends Offcut {
  reusable: boolean;
}

interface AreaTotals {
  input: bigint;
  required: bigint;
  reusable: bigint;
  waste: bigint;
}

function calculateOffcuts(plan: ResolvedCuttingPlan): Offcut[] {
  const offcuts: Offcut[] = plan.drops.flatMap((drop) =>
    dropOffcuts(
      toLengthUnits(drop.stock.widthMm),
      drop.length,
      drop.assignments,
      toLengthUnits(plan.settings.edgeTrimMm),
    ).map((offcut) => ({
      ...offcut,
      stockItemId: drop.stock.id,
      dropIndex: drop.index,
    })),
  );
  for (const { stock, plannedLength } of plan.stockUsage) {
    if (stock.isRemnant)
      offcuts.push({
        stockItemId: stock.id,
        dropIndex: null,
        kind: 'remnant-tail',
        width: toLengthUnits(stock.widthMm),
        length: toLengthUnits(stock.remainingLengthMm) - plannedLength,
        quantity: 1,
      });
  }
  return offcuts.filter((offcut) => offcut.width > 0n && offcut.length > 0n);
}

function classifyOffcuts(
  plan: ResolvedCuttingPlan,
  offcuts: readonly Offcut[],
): ClassifiedOffcut[] {
  const minWidth = toLengthUnits(plan.settings.minimumRemnantWidthMm);
  const minLength = toLengthUnits(plan.settings.minimumRemnantLengthMm);
  return offcuts.map(({ width, length, ...identity }) => ({
    ...identity,
    width,
    length,
    reusable: isReusableOffcut(width, length, minWidth, minLength),
  }));
}

function calculateAreas(
  plan: ResolvedCuttingPlan,
  offcuts: readonly ClassifiedOffcut[],
): AreaTotals {
  const areas: AreaTotals = {
    input: 0n,
    required: 0n,
    reusable: 0n,
    waste: 0n,
  };
  for (const { stock, plannedLength } of plan.stockUsage) {
    const length = stock.isRemnant
      ? toLengthUnits(stock.remainingLengthMm)
      : plannedLength;
    areas.input += toLengthUnits(stock.widthMm) * length;
  }
  for (const drop of plan.drops)
    for (const assignment of drop.assignments) {
      areas.required +=
        assignment.width * assignment.length * BigInt(assignment.quantity);
    }
  for (const offcut of offcuts) {
    const area = offcut.width * offcut.length * BigInt(offcut.quantity);
    if (offcut.reusable) areas.reusable += area;
    else areas.waste += area;
  }
  if (areas.input !== areas.required + areas.reusable + areas.waste)
    throw new Error('Cutting plan area accounting invariant failed.');
  return areas;
}

export function buildSummary(plan: ResolvedCuttingPlan): CuttingPlanSummary {
  const offcuts = classifyOffcuts(plan, calculateOffcuts(plan));
  const areas = calculateAreas(plan, offcuts);
  return {
    leftovers: offcuts.map(({ width, length, ...identity }) => ({
      ...identity,
      widthMm: toMillimetres(width),
      lengthMm: toMillimetres(length),
    })),
    reservations: plan.stockUsage.map(({ stock, plannedLength }) => ({
      stockItemId: stock.id,
      reservedLengthMm: toMillimetres(
        stock.isRemnant
          ? toLengthUnits(stock.remainingLengthMm)
          : plannedLength,
      ),
    })),
    inputAreaMm2: toSquareMillimetres(areas.input),
    requiredAreaMm2: toSquareMillimetres(areas.required),
    reusableAreaMm2: toSquareMillimetres(areas.reusable),
    wasteAreaMm2: toSquareMillimetres(areas.waste),
    dropCount: plan.drops.length,
    stockItemCount: plan.stockUsage.length,
    newRollCount: plan.stockUsage.filter(
      ({ stock }) => !stock.isRemnant && !stock.isUsed,
    ).length,
  };
}
