import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CompletionCorrection,
  CorrectionEligibility,
} from '@roller-bay/shared/corrections';
import type {
  StockEffect,
  StockSnapshot,
} from '@roller-bay/shared/stock-items';
import type { UnitOfWorkContext } from '../../unit-of-work/unit-of-work-context.js';
import { canonicalJson } from '../audit/audit.service.js';
import { snapshotWrite, stockSnapshot } from './stock-items.audit.js';
import { cuttingWrite, retainedPieceWrite } from './stock-items.cutting.js';
import { stockItemsOperation } from './stock-items.operation.js';
import type { StockItemWrite } from './stock-items.repository.js';
import type { ReceiveRollLine } from './stock-items.service.js';
type RecordedStockUsage = { source: StockEffect; pieces: StockEffect[] };
/**
 * The stock side of corrections to recorded workflows: receipts and cutting
 * results correct their own records and apply the stock changes here.
 */
@Injectable()
export class StockCorrectionsService {
  async lockForCorrection(context: UnitOfWorkContext, ids: string[]) {
    const repository = context.stockItems;
    return stockItemsOperation(async () =>
      (await repository.lockRows(ids)).map(stockSnapshot),
    );
  }
  async eligibility(
    context: UnitOfWorkContext,
    effects: StockEffect[],
    ids: string[],
    excludeAllocationId?: string,
  ): Promise<CorrectionEligibility[]> {
    const repository = context.stockItems;
    const refs = await repository.allocationReferences(ids);
    const children = await repository.descendants(ids);
    const baseline = new Map(effects.map((e) => [e.stockItemId, e]));
    const results: CorrectionEligibility[] = [];
    for (const id of ids) {
      const row = await repository.findById(id);
      if (!row) throw new NotFoundException('Stock item not found.');
      const blockers: CorrectionEligibility['blockers'] = [];
      const add = (
        code: CorrectionEligibility['blockers'][number]['code'],
        message: string,
        allocationIds: string[] = [],
        stockItemIds: string[] = [],
      ) => blockers.push({ code, message, allocationIds, stockItemIds });
      const effect = baseline.get(id);
      if (!effect)
        add(
          'legacy',
          'No trustworthy historical stock baseline exists. Use a current-stock adjustment.',
        );
      else if (effect.after.revision !== row.revision)
        add(
          'changed',
          'Stock changed after this workflow. Use a current-stock adjustment.',
        );
      if (row.voidedAt) add('voided', 'This stock record is voided.');
      const active = refs
        .filter((r) => r.stockItemId === id && !r.completedAt)
        .map((r) => r.allocationId);
      const completed = refs
        .filter(
          (r) =>
            r.stockItemId === id &&
            r.completedAt &&
            r.allocationId !== excludeAllocationId &&
            (!effect ||
              r.completedAt.getTime() >
                new Date(effect.after.updatedAt).getTime()),
        )
        .map((r) => r.allocationId);
      const downstream = children
        .filter((r) => r.sourceStockItemId === id && !baseline.has(r.id))
        .map((r) => r.id);
      if (active.length)
        add(
          'reserved',
          'Release or reassign reservations before correcting.',
          active,
        );
      if (completed.length || downstream.length)
        add(
          'downstream',
          'Later production or retained pieces depend on this stock.',
          completed,
          downstream,
        );
      results.push({ stockItemId: id, revision: row.revision, blockers });
    }
    return results;
  }
  async requireCorrectionEligible(
    context: UnitOfWorkContext,
    effects: StockEffect[],
    versions: {
      stockItemId: string;
      expectedRevision: number;
    }[],
    ids: string[],
    excludeAllocationId?: string,
  ) {
    const expected = new Map(
      versions.map((v) => [v.stockItemId, v.expectedRevision]),
    );
    if (expected.size !== versions.length)
      throw new BadRequestException('Duplicate stock revision.');
    const eligibility = await this.eligibility(
      context,
      effects,
      ids,
      excludeAllocationId,
    );
    for (const item of eligibility) {
      if (item.blockers.length)
        throw new ConflictException({
          message: 'Some stock cannot be corrected.',
          issues: item.blockers.map((b) => ({
            code: b.code,
            path: `stock.${item.stockItemId}`,
            message: b.message,
          })),
        });
      if (expected.get(item.stockItemId) !== item.revision)
        throw new ConflictException(
          'Stock changed; refresh before correcting.',
        );
    }
  }
  async applySnapshots(
    context: UnitOfWorkContext,
    changes: {
      before: StockSnapshot | null;
      value: StockSnapshot | StockItemWrite;
    }[],
  ): Promise<StockEffect[]> {
    const repository = context.stockItems;
    const effects: StockEffect[] = [];
    for (const change of changes) {
      const write =
        'id' in change.value ? snapshotWrite(change.value) : change.value;
      const id = change.before?.id ?? (await repository.create(write));
      if (change.before) await repository.update(id, write);
      const after = stockSnapshot((await repository.findById(id))!);
      effects.push({
        calculationThicknessMm: null,
        stockItemId: id,
        sourceStockItemId: after.sourceStockItemId,
        before: change.before,
        after,
      });
    }
    return effects;
  }
  /**
   * Voids the rolls a receipt correction removes (`line: null`) and gives the
   * others the corrected line's fabric, size and location.
   */
  reviseReceivedRolls(
    context: UnitOfWorkContext,
    rolls: {
      before: StockSnapshot;
      line: Omit<ReceiveRollLine, 'stockReceiptItemId' | 'quantity'> | null;
    }[],
  ) {
    return this.applySnapshots(
      context,
      rolls.map(({ before, line }) => ({
        before,
        value: line
          ? {
              ...before,
              fabricColorId: line.fabricColorId,
              widthMm: line.widthMm,
              initialLengthMm: line.initialLengthMm,
              locationId: line.locationId,
            }
          : { ...before, voidedAt: new Date().toISOString() },
      })),
    );
  }
  /**
   * Rewrites one recorded cutting outcome from the source's pre-completion
   * measurements. Every existing retained piece must be kept or voided.
   */
  async correctRecordedStockUsage(
    context: UnitOfWorkContext,
    {
      item,
      source,
      pieces,
    }: RecordedStockUsage & { item: CompletionCorrection['items'][number] },
    current: ReadonlyMap<string, StockSnapshot>,
    completedAt: Date,
  ) {
    const sourceBefore = source.before!;
    const actual = current.get(source.stockItemId)!;
    if (item.outcome.expectedRevision !== actual.revision)
      throw new ConflictException('Stock changed; refresh before correcting.');
    if (
      item.outcome.outcome === 'returned-roll' &&
      !source.calculationThicknessMm
    )
      throw new ConflictException(
        'The original thickness snapshot is unavailable. Use a current-stock adjustment.',
      );
    const write = cuttingWrite(
      sourceBefore,
      item.outcome,
      completedAt,
      source.calculationThicknessMm?.toFixed(3) ?? null,
    );
    const selectedPieceIds = item.retainedPieces.flatMap((p) =>
      p.id ? [p.id] : [],
    );
    if (
      new Set(selectedPieceIds).size !== selectedPieceIds.length ||
      selectedPieceIds.some(
        (pieceId) => !pieces.some((p) => p.stockItemId === pieceId),
      )
    )
      throw new BadRequestException(
        'Select distinct retained pieces from this source outcome.',
      );
    const identifiedPieceIds = [
      ...selectedPieceIds,
      ...item.removeRetainedPieceIds,
    ];
    if (
      new Set(identifiedPieceIds).size !== identifiedPieceIds.length ||
      identifiedPieceIds.some(
        (pieceId) => !pieces.some((p) => p.stockItemId === pieceId),
      ) ||
      pieces.some((piece) => !identifiedPieceIds.includes(piece.stockItemId))
    )
      throw new BadRequestException(
        'Keep or explicitly select every existing retained piece for voiding.',
      );
    const pending: Parameters<this['applySnapshots']>[1] = [];
    if (
      canonicalJson({ ...snapshotWrite(actual), ...write }) !==
      canonicalJson(snapshotWrite(actual))
    )
      pending.push({ before: actual, value: write });
    for (const piece of pieces)
      if (item.removeRetainedPieceIds.includes(piece.stockItemId)) {
        const previous = current.get(piece.stockItemId)!;
        pending.push({
          before: previous,
          value: { ...previous, voidedAt: new Date().toISOString() },
        });
      }
    for (const piece of item.retainedPieces) {
      const value = retainedPieceWrite(sourceBefore, piece);
      const previous = piece.id ? current.get(piece.id)! : null;
      if (
        !previous ||
        canonicalJson({ ...snapshotWrite(previous), ...value }) !==
          canonicalJson(snapshotWrite(previous))
      )
        pending.push({ before: previous, value });
    }
    return this.applySnapshots(context, pending);
  }
  /** Restores a source's pre-completion values and voids its retained pieces. */
  restoreUnusedStock(
    context: UnitOfWorkContext,
    { source, pieces }: RecordedStockUsage,
    current: ReadonlyMap<string, StockSnapshot>,
  ) {
    return this.applySnapshots(context, [
      {
        before: current.get(source.stockItemId)!,
        value: snapshotWrite(source.before!),
      },
      ...pieces.map((p) => ({
        before: current.get(p.stockItemId)!,
        value: {
          ...snapshotWrite(current.get(p.stockItemId)!),
          voidedAt: new Date(),
        },
      })),
    ]);
  }
}
