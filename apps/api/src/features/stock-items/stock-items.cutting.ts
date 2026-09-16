/** Applies observed cutting results to locked stock; estimated allocations never determine measured balances. */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  createStockItemSchema,
  type StockCuttingOutcome,
} from '@roller-bay/shared/stock-items';
import { StockItemsRepository } from './stock-items.repository.js';

export async function recordCuttingResults(
  repository: StockItemsRepository,
  outcomes: StockCuttingOutcome[],
  now: Date,
): Promise<string[]> {
  const createdIds: string[] = [];
  for (const outcome of [...outcomes].sort((a, b) =>
    a.stockItemId.localeCompare(b.stockItemId),
  )) {
    const current = await repository.findByIdForUpdate(outcome.stockItemId);
    if (!current)
      throw new NotFoundException('Allocated stock item no longer exists.');
    if (current.consumedAt)
      throw new ConflictException(
        'Allocated stock has already been consumed; revise the allocation first.',
      );
    if (
      current.updatedAt.getTime() !==
      new Date(outcome.expectedUpdatedAt).getTime()
    )
      throw new ConflictException(
        'Stock measurements changed; refresh before entering completion results.',
      );
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
      throw new BadRequestException(
        'The recorded tube diameter cannot change.',
      );
    if (outcome.outcome === 'returned-roll' && current.isRemnant)
      throw new BadRequestException('A remnant cannot be returned as a roll.');
    if (outcome.outcome === 'returned-remnant' && !current.isRemnant)
      throw new BadRequestException(
        'Return the roll or mark it consumed and record its retained scraps.',
      );
    const input = createStockItemSchema.safeParse({
      fabricColorId: current.fabricColorId,
      isRemnant: current.isRemnant,
      isUsed: true,
      widthMm:
        outcome.outcome === 'returned-remnant'
          ? outcome.widthMm
          : Number(current.widthMm),
      initialLengthMm: Number(current.initialLengthMm),
      explicitLengthMm:
        outcome.outcome === 'returned-remnant'
          ? outcome.explicitLengthMm
          : current.explicitLengthMm === null
            ? null
            : Number(current.explicitLengthMm),
      radialDepthMm:
        outcome.outcome === 'returned-roll'
          ? outcome.radialDepthMm
          : current.radialDepthMm === null
            ? null
            : Number(current.radialDepthMm),
      tubeOuterDiameterMm: current.isRemnant
        ? null
        : (current.tubeOuterDiameterMm ?? tube ?? null),
      locationId:
        outcome.outcome === 'consumed'
          ? current.locationId
          : outcome.locationId,
      sourceStockItemId: current.sourceStockItemId,
      consumedAt: outcome.outcome === 'consumed' ? now.toISOString() : null,
    });
    if (!input.success)
      throw new BadRequestException({
        message: 'Invalid cutting measurements.',
        issues: input.error.issues,
      });
    if (input.data.widthMm > Number(current.widthMm))
      throw new BadRequestException(
        'A returned remnant cannot be wider than its source.',
      );
    let thickness = current.measurementThicknessMm;
    if (outcome.outcome === 'returned-roll') {
      const color = await repository.findColor(current.fabricColorId);
      if (!color) throw new NotFoundException('Fabric color no longer exists.');
      thickness = color.thicknessMm;
    }
    const value = input.data;
    await repository.update(current.id, {
      ...value,
      widthMm: value.widthMm.toFixed(3),
      initialLengthMm: value.initialLengthMm.toFixed(3),
      explicitLengthMm: value.explicitLengthMm?.toFixed(3) ?? null,
      radialDepthMm: value.radialDepthMm?.toFixed(3) ?? null,
      measurementThicknessMm: thickness,
      consumedAt: value.consumedAt ? now : null,
    });
    for (const scrap of outcome.scraps) {
      if (scrap.widthMm > Number(current.widthMm))
        throw new BadRequestException(
          'Retained scraps cannot be wider than their source fabric.',
        );
      for (let i = 0; i < scrap.quantity; i++)
        createdIds.push(
          await repository.create({
            fabricColorId: current.fabricColorId,
            isRemnant: true,
            isUsed: true,
            widthMm: scrap.widthMm.toFixed(3),
            initialLengthMm: scrap.lengthMm.toFixed(3),
            explicitLengthMm: scrap.lengthMm.toFixed(3),
            radialDepthMm: null,
            tubeOuterDiameterMm: null,
            measurementThicknessMm: null,
            locationId: scrap.locationId,
            sourceStockItemId: current.id,
            consumedAt: null,
          }),
        );
    }
  }
  return createdIds;
}
