/** Applies observed cutting results; estimated usage never determines measured balances. */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  createStockItemSchema,
  type StockCuttingOutcome,
  type StockSnapshot,
} from '@roller-bay/shared/stock-items';
import {
  StockItemsRepository,
  type StockItemWrite,
} from './stock-items.repository.js';
import { stockSnapshot } from './stock-items.audit.js';

export function cuttingWrite(
  current: StockSnapshot,
  outcome: StockCuttingOutcome,
  now: Date,
  thickness: string | null,
): StockItemWrite {
  const tube =
    outcome.outcome === 'returned-remnant'
      ? undefined
      : outcome.tubeOuterDiameterMm;
  if (current.isRemnant && tube !== undefined)
    throw new BadRequestException('Remnants cannot have a tube diameter.');
  if (
    current.tubeOuterDiameterMm !== null &&
    tube !== undefined &&
    tube !== current.tubeOuterDiameterMm
  )
    throw new BadRequestException('The recorded tube diameter cannot change.');
  if (outcome.outcome === 'returned-roll' && current.isRemnant)
    throw new BadRequestException('A remnant cannot be returned as a roll.');
  if (outcome.outcome === 'returned-remnant' && !current.isRemnant)
    throw new BadRequestException(
      'Return the roll or mark it consumed and record its retained pieces.',
    );
  const input = createStockItemSchema.safeParse({
    fabricColorId: current.fabricColorId,
    isRemnant: current.isRemnant,
    isUsed: true,
    widthMm:
      outcome.outcome === 'returned-remnant'
        ? outcome.widthMm
        : current.widthMm,
    initialLengthMm: current.initialLengthMm,
    explicitLengthMm:
      outcome.outcome === 'returned-remnant'
        ? outcome.explicitLengthMm
        : current.explicitLengthMm,
    radialDepthMm:
      outcome.outcome === 'returned-roll'
        ? outcome.radialDepthMm
        : current.radialDepthMm,
    tubeOuterDiameterMm: current.isRemnant
      ? null
      : (current.tubeOuterDiameterMm ?? tube ?? null),
    locationId:
      outcome.outcome === 'consumed' ? current.locationId : outcome.locationId,
    sourceStockItemId: current.sourceStockItemId,
    consumedAt: outcome.outcome === 'consumed' ? now.toISOString() : null,
  });
  if (!input.success)
    throw new BadRequestException({
      message: 'Invalid cutting measurements.',
      issues: input.error.issues,
    });
  const v = input.data;
  if (v.widthMm > current.widthMm)
    throw new BadRequestException(
      'A returned remnant cannot be wider than its source.',
    );
  return {
    ...v,
    widthMm: v.widthMm.toFixed(3),
    initialLengthMm: v.initialLengthMm.toFixed(3),
    explicitLengthMm: v.explicitLengthMm?.toFixed(3) ?? null,
    radialDepthMm: v.radialDepthMm?.toFixed(3) ?? null,
    tubeOuterDiameterMm: v.tubeOuterDiameterMm?.toFixed(3) ?? null,
    measurementThicknessMm:
      outcome.outcome === 'returned-roll'
        ? thickness
        : (current.measurementThicknessMm?.toFixed(3) ?? null),
    consumedAt: v.consumedAt ? now : null,
  };
}
export function retainedPieceWrite(
  source: StockSnapshot,
  piece: { widthMm: number; lengthMm: number; locationId: string },
): StockItemWrite {
  if (piece.widthMm > source.widthMm)
    throw new BadRequestException(
      'Retained pieces cannot be wider than their source fabric.',
    );
  return {
    fabricColorId: source.fabricColorId,
    isRemnant: true,
    isUsed: true,
    widthMm: piece.widthMm.toFixed(3),
    initialLengthMm: piece.lengthMm.toFixed(3),
    explicitLengthMm: piece.lengthMm.toFixed(3),
    radialDepthMm: null,
    tubeOuterDiameterMm: null,
    measurementThicknessMm: null,
    locationId: piece.locationId,
    sourceStockItemId: source.id,
    consumedAt: null,
  };
}
export async function recordCuttingResults(
  repository: StockItemsRepository,
  outcomes: StockCuttingOutcome[],
  now: Date,
): Promise<{
  createdIds: string[];
  calculationThickness: Map<string, number>;
}> {
  const createdIds: string[] = [];
  const calculationThickness = new Map<string, number>();
  for (const outcome of [...outcomes].sort((a, b) =>
    a.stockItemId.localeCompare(b.stockItemId),
  )) {
    const row = await repository.findByIdForUpdate(outcome.stockItemId);
    if (!row)
      throw new NotFoundException('Allocated stock item no longer exists.');
    if (row.consumedAt || row.voidedAt)
      throw new ConflictException(
        'Allocated stock is consumed or voided; revise the allocation first.',
      );
    if (row.revision !== outcome.expectedRevision)
      throw new ConflictException(
        'Stock measurements changed; refresh before entering completion results.',
      );
    const current = stockSnapshot(row);
    const color = await repository.findColor(current.fabricColorId);
    if (!color) throw new NotFoundException('Fabric color no longer exists.');
    calculationThickness.set(current.id, Number(color.thicknessMm));
    await repository.update(
      current.id,
      cuttingWrite(current, outcome, now, color.thicknessMm),
    );
    for (const scrap of outcome.scraps)
      for (let i = 0; i < scrap.quantity; i++)
        createdIds.push(
          await repository.create(retainedPieceWrite(current, scrap)),
        );
  }
  return { createdIds, calculationThickness };
}
