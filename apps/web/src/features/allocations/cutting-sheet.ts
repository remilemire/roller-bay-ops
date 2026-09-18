import type { AllocationDetail } from '@roller-bay/shared/allocations';
import type { StockItem } from '@roller-bay/shared/stock-items';

export interface SheetBlind {
  number: number;
  widthMm: number;
}
export interface SheetCut {
  number: number;
  lengthMm: number;
  blinds: SheetBlind[];
}
export interface SheetRemnant {
  widthMm: number;
  lengthMm: number;
  quantity: number;
  source: string;
}
export interface SheetItem {
  stockItem: StockItem;
  cuts: SheetCut[];
  lengthBeforeMm: number;
  estimatedAfterMm: number;
  /** Reusable planned leftovers, or null when the plan has no saved summary. */
  plannedRemnants: SheetRemnant[] | null;
}

type Leftover = NonNullable<
  AllocationDetail['plannedSummary']
>['leftovers'][number];

const kindLabel: Record<Leftover['kind'], string> = {
  'left-edge': 'left edge',
  'right-edge': 'right edge',
  shortening: 'shortening',
  'remnant-tail': 'remnant tail',
};

// cutIndex is the position in the whole plan, the same numbering the sheet
// and the detail page print for each cut.
export const leftoverSource = ({
  kind,
  cutIndex,
}: Pick<Leftover, 'kind' | 'cutIndex'>) =>
  cutIndex === null
    ? kindLabel[kind]
    : `Cut ${cutIndex + 1} · ${kindLabel[kind]}`;

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** One block per selected stock item, in the order the plan first uses it. */
export function cuttingSheetItems(allocation: AllocationDetail): SheetItem[] {
  const cutsByStock = new Map<string, SheetCut[]>();
  allocation.plan.cuts.forEach((cut, index) => {
    const cuts = cutsByStock.get(cut.stockItemId) ?? [];
    cuts.push({
      number: index + 1,
      lengthMm: cut.lengthMm,
      // One entry per physical blind, in assignment order.
      blinds: cut.items.flatMap((assignment) => {
        const position = allocation.requirements.findIndex(
          (r) => r.id === assignment.requirementId,
        );
        const requirement = allocation.requirements[position];
        return requirement
          ? Array.from({ length: assignment.quantity }, () => ({
              number: position + 1,
              widthMm: requirement.widthMm,
            }))
          : [];
      }),
    });
    cutsByStock.set(cut.stockItemId, cuts);
  });
  return [...cutsByStock].flatMap(([stockItemId, cuts]) => {
    const stockItem = allocation.items.find(
      (item) => item.stockItemId === stockItemId,
    )?.stockItem;
    if (!stockItem) return [];
    // The reservation is not the planned use: a remnant reserves its whole
    // piece. Subtract the cuts instead; only a plan needing replanning goes
    // negative, and the sheet warns about that separately.
    const planned = cuts.reduce((sum, cut) => sum + cut.lengthMm, 0);
    return [
      {
        stockItem,
        cuts,
        lengthBeforeMm: stockItem.remainingLengthMm,
        estimatedAfterMm: Math.max(
          0,
          round3(stockItem.remainingLengthMm - planned),
        ),
        plannedRemnants:
          allocation.plannedSummary?.leftovers
            .filter((l) => l.stockItemId === stockItemId && l.reusable)
            .map(({ widthMm, lengthMm, quantity, ...leftover }) => ({
              widthMm,
              lengthMm,
              quantity,
              source: leftoverSource(leftover),
            })) ?? null,
      },
    ];
  });
}
