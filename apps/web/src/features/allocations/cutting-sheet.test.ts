import { expect, it } from 'vitest';
import type { StockItem } from '@roller-bay/shared/stock-items';
import type { AllocationDetail } from '@roller-bay/shared/allocations';
import { allocation, stock } from '../../../tests/fixtures';
import { cuttingSheetItems, leftoverSource } from './cutting-sheet';

const remnant: StockItem = {
  ...stock,
  id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  isRemnant: true,
  isUsed: true,
  remainingLengthMm: 5000,
  explicitLengthMm: 5000,
};
const requirement = allocation.requirements[0]!;
const planned = (
  stocks: StockItem[],
  cuts: { stockItemId: string; lengthMm: number; quantity?: number }[],
): AllocationDetail => ({
  ...allocation,
  items: stocks.map((item) => ({
    id: item.id,
    stockItemId: item.id,
    reservedLengthMm: item.remainingLengthMm,
    stockItem: item,
  })),
  plan: {
    cuts: cuts.map(({ quantity = 1, ...cut }) => ({
      ...cut,
      items: [{ requirementId: requirement.id, quantity }],
    })),
  },
});

it('groups cuts by stock in plan order and estimates the balance from the planned cuts', () => {
  const items = cuttingSheetItems(
    planned(
      [stock, remnant],
      [
        { stockItemId: remnant.id, lengthMm: 1200 },
        { stockItemId: stock.id, lengthMm: 2743.2, quantity: 2 },
        { stockItemId: remnant.id, lengthMm: 800 },
      ],
    ),
  );
  const [remnantItem, rollItem] = items;
  expect(items.map((item) => item.stockItem.id)).toEqual([
    remnant.id,
    stock.id,
  ]);
  expect(remnantItem?.cuts.map((cut) => cut.number)).toEqual([1, 3]);
  // The remnant reserves its whole 5000 mm; the estimate still follows its cuts.
  expect(remnantItem).toMatchObject({
    lengthBeforeMm: 5000,
    estimatedAfterMm: 3000,
    plannedRemnants: null,
  });
  expect(rollItem?.cuts.map((cut) => cut.number)).toEqual([2]);
  expect(rollItem).toMatchObject({
    lengthBeforeMm: 54864,
    estimatedAfterMm: 52120.8,
  });
  // Two copies of the same blind print as two lines.
  expect(rollItem?.cuts[0]?.blinds).toEqual([
    { number: 1, widthMm: 1371.6 },
    { number: 1, widthMm: 1371.6 },
  ]);
});

it('never estimates a balance below zero', () => {
  const short = { ...stock, remainingLengthMm: 2000 };
  expect(
    cuttingSheetItems(
      planned([short], [{ stockItemId: short.id, lengthMm: 2743.2 }]),
    )[0]?.estimatedAfterMm,
  ).toBe(0);
});

it("lists only this stock item's reusable planned leftovers", () => {
  const leftover = {
    stockItemId: stock.id,
    cutIndex: 0,
    widthMm: 1574.8,
    lengthMm: 2743.2,
    quantity: 1,
    reusable: true,
  };
  const items = cuttingSheetItems({
    ...allocation,
    plannedSummary: {
      leftovers: [
        { ...leftover, kind: 'right-edge' },
        { ...leftover, kind: 'left-edge', widthMm: 25.4, reusable: false },
        {
          ...leftover,
          stockItemId: remnant.id,
          cutIndex: null,
          kind: 'remnant-tail',
        },
      ],
      reservations: [],
      inputAreaMm2: '0.000000',
      requiredAreaMm2: '0.000000',
      reusableAreaMm2: '0.000000',
      wasteAreaMm2: '0.000000',
      cutCount: 1,
      stockItemCount: 1,
      newRollCount: 1,
    },
  });
  expect(items[0]?.plannedRemnants).toEqual([
    {
      widthMm: 1574.8,
      lengthMm: 2743.2,
      quantity: 1,
      source: 'Cut 1 · right edge',
    },
  ]);
  expect(leftoverSource({ kind: 'remnant-tail', cutIndex: null })).toBe(
    'remnant tail',
  );
});
