/** Exact rectangle geometry shared by plan accounting and candidate-pattern scoring. */
import type {
  CuttingLeftover,
  ResolvedAssignment,
} from './cutting-plan.types.js';

export interface CuttingOffcut {
  kind: CuttingLeftover['kind'];
  width: bigint;
  length: bigint;
  quantity: number;
}

export function cutOffcuts(
  stockWidth: bigint,
  length: bigint,
  assignments: readonly ResolvedAssignment[],
  trim: bigint,
): CuttingOffcut[] {
  const occupiedWidth = assignments.reduce(
    (sum, item) => sum + item.width * BigInt(item.quantity),
    0n,
  );
  const offcuts: CuttingOffcut[] = [
    ...assignments.map((item): CuttingOffcut => ({
      kind: 'shortening',
      width: item.width,
      length: length - item.length,
      quantity: item.quantity,
    })),
    { kind: 'left-edge', width: trim, length, quantity: 1 },
    {
      kind: 'right-edge',
      width: stockWidth - trim - occupiedWidth,
      length,
      quantity: 1,
    },
  ];
  return offcuts.filter((offcut) => offcut.width > 0n && offcut.length > 0n);
}

export function isReusableOffcut(
  width: bigint,
  length: bigint,
  minimumWidth: bigint,
  minimumLength: bigint,
): boolean {
  return width >= minimumWidth && length >= minimumLength;
}
