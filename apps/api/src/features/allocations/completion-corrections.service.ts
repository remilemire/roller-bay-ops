import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  allocationDetailSchema,
  type AllocationDetail,
} from '@roller-bay/shared/allocations';
import {
  completionCorrectionContextSchema,
  type CompletionCorrection,
} from '@roller-bay/shared/corrections';
import type {
  StockEffect,
  StockSnapshot,
} from '@roller-bay/shared/stock-items';
import type { UnitOfWorkContext } from '../../unit-of-work/unit-of-work-context.js';
import { UnitOfWork } from '../../unit-of-work/unit-of-work.js';
import { AuditService } from '../audit/audit.service.js';
import { CuttingWorksheetsService } from '../cutting-worksheets/cutting-worksheets.service.js';
import { StockCorrectionsService } from '../stock-items/stock-corrections.service.js';
import { stockChanges } from '../stock-items/stock-items.audit.js';
import { StockItemsService } from '../stock-items/stock-items.service.js';
import { AllocationDetailsService } from './allocation-details.service.js';
import { allocationOperation } from './allocations.operation.js';
/**
 * Corrects a completed allocation's recorded cutting results. The plan,
 * the original completion and production milestones stay unchanged.
 */
@Injectable()
export class CompletionCorrectionsService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly worksheets: CuttingWorksheetsService,
    private readonly audit: AuditService,
    private readonly stockItems: StockItemsService,
    private readonly stockCorrections: StockCorrectionsService,
    private readonly details: AllocationDetailsService,
  ) {}
  context(id: string) {
    return allocationOperation(() =>
      this.unitOfWork.readOnlyTransaction(async (context) => {
        const header = await context.allocations.findById(id);
        if (!header) throw new NotFoundException('Allocation not found.');
        if (!header.completedAt)
          throw new ConflictException(
            'Only completed cutting results can be corrected.',
          );
        const effects = header.stockEffects ?? [];
        const ids = effects
          .filter((e) => !e.after.voidedAt)
          .map((e) => e.stockItemId);
        return completionCorrectionContextSchema.parse({
          record: await this.details.load(context, header),
          baselineAvailable: header.stockEffects !== null,
          effects,
          stockItems: await this.stockItems.findForAllocation(context, {
            stockIds: ids,
          }),
          eligibility: await this.stockCorrections.eligibility(
            context,
            effects,
            ids,
            id,
          ),
        });
      }),
    );
  }
  correct(
    id: string,
    input: CompletionCorrection,
    userId: string,
    key: string,
  ) {
    return allocationOperation(() =>
      this.unitOfWork.transaction(async (context) => {
        const header = await context.allocations.findById(id, true);
        if (!header) throw new NotFoundException('Allocation not found.');
        const audit = this.audit;
        // Empty new fields must not change retry identity for pre-upgrade requests.
        const { additionalItems, unusedStockItemIds, ...existingInput } = input;
        const replayInput = {
          ...existingInput,
          ...(additionalItems.length ? { additionalItems } : {}),
          ...(unusedStockItemIds.length ? { unusedStockItemIds } : {}),
        };
        const replay = await audit.replay(
          context,
          userId,
          'allocation.correct-completion',
          id,
          key,
          replayInput,
        );
        if (replay.result) return replay.result;
        if (
          !header.completedAt ||
          !header.completion ||
          header.revision !== input.expectedRevision
        )
          throw new ConflictException(
            'Allocation changed or is not completed.',
          );
        if (!header.stockEffects)
          throw new ConflictException(
            'This older completion lacks a trustworthy stock baseline. Use current-stock adjustments.',
          );
        const effective = structuredClone(
          header.effectiveCompletion ?? header.completion,
        );
        const selectedIds = [
          ...input.items.map((i) => i.outcome.stockItemId),
          ...input.unusedStockItemIds,
          ...input.additionalItems.map((i) => i.stockItemId),
        ];
        if (new Set(selectedIds).size !== selectedIds.length)
          throw new BadRequestException(
            'Correct each cutting result only once.',
          );
        const baseline = new Map(
          header.stockEffects.map((e) => [e.stockItemId, e]),
        );
        const families = input.items.map((item) => {
          const source = baseline.get(item.outcome.stockItemId);
          if (
            !source?.before ||
            !effective.items.some((i) => i.stockItemId === source.stockItemId)
          )
            throw new BadRequestException(
              'Select a source outcome from this allocation.',
            );
          const pieces = header.stockEffects!.filter(
            (e) =>
              !e.before &&
              e.sourceStockItemId === source.stockItemId &&
              !e.after.voidedAt,
          );
          return { item, source, pieces };
        });
        const unused = input.unusedStockItemIds.map((id) => {
          const source = baseline.get(id);
          if (
            !source?.before ||
            !effective.items.some((i) => i.stockItemId === id)
          )
            throw new BadRequestException(
              'Select a recorded source roll to mark unused.',
            );
          return {
            source,
            pieces: header.stockEffects!.filter(
              (e) =>
                !e.before && e.sourceStockItemId === id && !e.after.voidedAt,
            ),
          };
        });
        const familyIds = [...families, ...unused].flatMap((f) => [
          f.source.stockItemId,
          ...f.pieces.map((p) => p.stockItemId),
        ]);
        const additionalIds = input.additionalItems.map((i) => i.stockItemId);
        if (
          additionalIds.some((id) =>
            effective.items.some((i) => i.stockItemId === id),
          )
        )
          throw new BadRequestException(
            'This roll already has cutting results; correct them instead.',
          );
        const rows = await this.stockCorrections.lockForCorrection(context, [
          ...familyIds,
          ...additionalIds,
        ]);
        await this.worksheets.assertStockReconciliationAllowed(context, [
          ...familyIds,
          ...additionalIds,
        ]);
        await this.stockCorrections.requireCorrectionEligible(
          context,
          header.stockEffects,
          input.stockVersions,
          familyIds,
          id,
        );
        const current = new Map(rows.map((r) => [r.id, r]));
        const before = await this.details.load(context, header);
        const effects: StockEffect[] = [];
        await this.assertAdditionalStockUsageAllowed(
          context,
          id,
          input.additionalItems,
          allocationDetailSchema.parse(before).requirements,
          current,
        );
        for (const family of families) {
          const { item, source } = family;
          const applied = await this.stockCorrections.correctRecordedStockUsage(
            context,
            family,
            current,
            header.completedAt,
          );
          effects.push(...applied);
          for (const e of applied) {
            const original = baseline.get(e.stockItemId);
            baseline.set(e.stockItemId, {
              ...e,
              before: original ? original.before : e.before,
              calculationThicknessMm:
                original?.calculationThicknessMm ??
                source.calculationThicknessMm,
            });
          }
          const index = effective.items.findIndex(
            (i) => i.stockItemId === source.stockItemId,
          );
          effective.items[index] = {
            ...item.outcome,
            scraps: item.retainedPieces.map((p) => ({
              widthMm: p.widthMm,
              lengthMm: p.lengthMm,
              locationId: p.locationId,
              quantity: 1,
            })),
          };
        }
        for (const usage of unused) {
          const { source } = usage;
          const restored = await this.stockCorrections.restoreUnusedStock(
            context,
            usage,
            current,
          );
          for (const effect of restored) {
            effects.push(effect);
            const original = baseline.get(effect.stockItemId)!;
            baseline.set(effect.stockItemId, {
              ...effect,
              before: original.before,
              calculationThicknessMm: original.calculationThicknessMm,
            });
          }
          effective.items = effective.items.filter(
            (i) => i.stockItemId !== source.stockItemId,
          );
        }
        if (input.additionalItems.length) {
          const added = await this.stockItems.recordCuttingResults(
            input.additionalItems,
            context,
            new Date(),
          );
          for (const effect of added) {
            effects.push(effect);
            // A roll previously marked unused starts from its newly captured balance.
            baseline.set(effect.stockItemId, effect);
          }
          effective.items.push(...input.additionalItems);
        }
        if (!effects.length)
          throw new BadRequestException('Provide an actual change.');
        effective.createdStockItemIds = [...baseline.values()]
          .filter((e) => !e.before && !e.after.voidedAt)
          .map((e) => e.stockItemId);
        if (effective.createdStockItemIds.length > 1000)
          throw new BadRequestException(
            'A completion supports at most 1,000 retained pieces.',
          );
        effective.affectedAllocationIds =
          await context.allocations.affectedAllocations([
            ...familyIds,
            ...additionalIds,
          ]);
        const saved = await context.allocations.update(id, {
          stockEffects: [...baseline.values()],
          effectiveCompletion: effective,
          correctedAt: new Date(),
        });
        const result = await this.details.load(context, saved);
        const eventId = await audit.record(
          context,
          userId,
          'allocation.completion-corrected',
          [
            {
              recordType: 'allocations',
              recordId: id,
              before: { type: 'allocations', value: before },
              after: { type: 'allocations', value: result },
            },
            ...stockChanges(effects),
          ],
          input.reason,
        );
        return audit.remember(
          context,
          userId,
          'allocation.correct-completion',
          id,
          key,
          replay.requestHash,
          {
            eventId,
            recordId: id,
            revision: saved.revision,
            affectedAllocationIds: effective.affectedAllocationIds,
            createdStockItemIds: effects
              .filter((e) => !e.before)
              .map((e) => e.stockItemId),
          },
        );
      }),
    );
  }
  private async assertAdditionalStockUsageAllowed(
    context: UnitOfWorkContext,
    allocationId: string,
    items: CompletionCorrection['additionalItems'],
    requirements: AllocationDetail['requirements'],
    current: ReadonlyMap<string, StockSnapshot>,
  ) {
    const additionalIds = items.map((item) => item.stockItemId);
    for (const id of additionalIds) {
      const stock = current.get(id)!;
      if (!requirements.some((r) => r.fabricColorId === stock.fabricColorId))
        throw new BadRequestException(
          'Additional fabric must match a color on the order.',
        );
    }
    // Additional usage is a new observation against current stock, never a
    // reconstruction of its balance at the original completion time.
    await this.stockCorrections.requireCorrectionEligible(
      context,
      additionalIds.map((id) => ({
        calculationThicknessMm: null,
        stockItemId: id,
        sourceStockItemId: current.get(id)!.sourceStockItemId,
        before: current.get(id)!,
        after: current.get(id)!,
      })),
      items.map((i) => ({
        stockItemId: i.stockItemId,
        expectedRevision: i.expectedRevision,
      })),
      additionalIds,
      allocationId,
    );
  }
}
