import type { CuttingContext } from '@roller-bay/shared/allocations';
import type { StockItem } from '@roller-bay/shared/stock-items';

export function buildCuttingContext(
  input: Pick<CuttingContext, 'requirements' | 'settings'>,
  stock: readonly StockItem[],
  reserved: ReadonlyMap<string, string>,
): CuttingContext {
  return {
    requirements: input.requirements,
    settings: {
      edgeTrimMm: input.settings.edgeTrimMm,
      minimumRemnantWidthMm: input.settings.minimumRemnantWidthMm,
      minimumRemnantLengthMm: input.settings.minimumRemnantLengthMm,
    },
    stockItems: stock.map((item) => ({
      id: item.id,
      fabricColorId: item.fabricColorId,
      widthMm: item.widthMm,
      remainingLengthMm: item.remainingLengthMm,
      reservedLengthMm: Number(reserved.get(item.id) ?? 0),
      isRemnant: item.isRemnant,
      isUsed: item.isUsed,
      consumedAt: item.consumedAt,
      voidedAt: item.voidedAt,
    })),
  };
}
