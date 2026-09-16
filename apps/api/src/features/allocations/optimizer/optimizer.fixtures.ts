import type { CuttingContext } from '@roller-bay/shared/allocations';

export const id = (value: number) =>
  `00000000-0000-4000-8000-${value.toString().padStart(12, '0')}`;

export function fixture(): CuttingContext {
  return {
    requirements: [
      {
        id: id(1),
        fabricColorId: id(10),
        widthMm: 4,
        lengthMm: 3,
        lengthAllowanceMm: 0,
        quantity: 2,
      },
    ],
    stockItems: [
      {
        id: id(20),
        fabricColorId: id(10),
        widthMm: 10,
        remainingLengthMm: 9,
        reservedLengthMm: 0,
        isRemnant: false,
        isUsed: true,
        consumedAt: null,
      },
    ],
    settings: {
      edgeTrimMm: 1,
      minimumRemnantWidthMm: 3,
      minimumRemnantLengthMm: 2,
    },
  };
}

export function allocatorFixture(): CuttingContext {
  const inches = (value: number) => Number((value * 25.4).toFixed(3));
  const yards = (value: number) => Number((value * 914.4).toFixed(3));
  return {
    requirements: (
      [
        [54, 2.5, 1, 10],
        [22, 1.5, 2, 10],
        [70, 1, 1, 10],
        [53.5, 3.5, 1, 11],
        [24, 1, 3, 11],
      ] as const
    ).map(([width, length, quantity, color], index) => ({
      id: id(index + 1),
      fabricColorId: id(color),
      widthMm: inches(width),
      lengthMm: yards(length),
      lengthAllowanceMm: yards(0.5),
      quantity,
    })),
    stockItems: (
      [
        [20, 10, 118, 10, false],
        [21, 11, 72, 10, false],
        [22, 11, 30, 2, true],
        [23, 11, 30, 2, true],
        [24, 11, 30, 2, true],
      ] as const
    ).map(([stockId, color, width, length, isRemnant]) => ({
      id: id(stockId),
      fabricColorId: id(color),
      widthMm: inches(width),
      remainingLengthMm: yards(length),
      reservedLengthMm: 0,
      isRemnant,
      isUsed: isRemnant,
      consumedAt: null,
    })),
    settings: {
      edgeTrimMm: inches(0.5),
      minimumRemnantWidthMm: inches(20),
      minimumRemnantLengthMm: yards(0.5),
    },
  };
}
