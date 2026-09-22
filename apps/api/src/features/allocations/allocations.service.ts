import { CuttingWorksheetsService } from '../cutting-worksheets/cutting-worksheets.service.js';
import { AuditService, canonicalJson } from '../audit/audit.service.js';
import {
  stockChanges,
  snapshotWrite,
} from '../stock-items/stock-items.audit.js';
import {
  cuttingWrite,
  retainedPieceWrite,
} from '../stock-items/stock-items.cutting.js';
import type { StockEffect } from '@roller-bay/shared/stock-items';
import {
  completionCorrectionContextSchema,
  type CompletionCorrection,
} from '@roller-bay/shared/corrections';
/**
 * Reservation-changing writes lock the allocation header, then its work
 * order, then stock in a common order before checking availability.
 *
 * The blinds a plan assigns are the work order's. This service reads them
 * through WorkOrdersService and maintains only the allocation timestamp.
 * Production milestones are recorded independently.
 */
import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  allocationDetailSchema,
  allocationDraftSchema,
  allocationDraftDataSchema,
  createAllocationSchema,
  type AllocationDraftInput,
  type AllocationQuery,
  type CreateAllocation,
  type ReplaceAllocation,
  completeAllocationSchema,
  type CompleteAllocationRequest,
} from '@roller-bay/shared/allocations';
import { WorkOrdersService } from '../work-orders/work-orders.service.js';
import { StockItemsService } from '../stock-items/stock-items.service.js';
import type { DatabaseTransaction } from '../../database/database.service.js';
import {
  AllocationsRepository,
  type AllocationRecord,
} from './allocations.repository.js';
import { allocationOperation } from './allocations.operation.js';
import { allocationSummary } from './allocations.presenter.js';
import {
  requireActiveRevision,
  requireDraftRevision,
} from './allocation.rules.js';
import { buildCuttingContext } from './allocation-cutting-context.js';
import { validateCuttingPlan } from './cutting-plan/cutting-plan.validator.js';
import {
  CuttingRulesService,
  planCutLengths,
  type ConfiguredAllocationPlan,
} from './cutting-rules.service.js';
import { toLengthUnits } from './cutting-plan/cutting-dimensions.js';

type Line = Awaited<ReturnType<WorkOrdersService['linesById']>>[number];
type Plan = { cuts: { items: { requirementId: string }[] }[] };
const requirementsOf = (lines: Line[]) =>
  lines.map((line) => ({
    id: line.id,
    fabricColorId: line.fabricColorId,
    widthMm: Number(line.widthMm),
    lengthMm: Number(line.lengthMm),
    quantity: line.quantity,
  }));
/** A plan may assign only blinds that are on its order now. */
function requireOrderLines(lines: Line[], plan: Plan) {
  const ids = new Set(lines.map((line) => line.id));
  const issues = plan.cuts.flatMap((cut, i) =>
    cut.items.flatMap((item, j) =>
      ids.has(item.requirementId)
        ? []
        : [
            {
              code: 'line_not_on_order',
              path: ['plan', 'cuts', i, 'items', j, 'requirementId'],
              message: 'This blind is not on the order.',
            },
          ],
    ),
  );
  if (issues.length)
    throw new BadRequestException({
      message: 'The plan assigns a blind that is not on the order.',
      issues,
    });
}
const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

@Injectable()
export class AllocationsService {
  constructor(
    private readonly worksheets: CuttingWorksheetsService,
    private readonly audit: AuditService,
    private readonly repository: AllocationsRepository,
    private readonly stockItems: StockItemsService,
    private readonly cuttingRules: CuttingRulesService,
    private readonly orders: WorkOrdersService,
  ) {}

  create(input: CreateAllocation, userId: string, key: string) {
    const requestHash = hash(input);
    return allocationOperation(() =>
      this.repository.withTransaction(async (repository, tx) => {
        const header = await repository.create({
          workOrderId: input.workOrderId,
          createdByUserId: userId,
          idempotencyKey: key,
          requestHash,
        });
        if (!header) {
          const previous = await repository.findByKey(userId, key);
          if (!previous || previous.requestHash !== requestHash)
            throw new ConflictException(
              'This Idempotency-Key was used for a different allocation.',
            );
          return this.detail(repository, tx, previous);
        }
        return this.confirmPlan(
          repository,
          tx,
          header,
          input.plan,
          false,
          userId,
        );
      }),
    );
  }

  createDraft(data: AllocationDraftInput, userId: string, key: string) {
    const requestHash = hash({ mode: 'draft', data });
    return allocationOperation(() =>
      this.repository.withTransaction(async (repository, tx) => {
        const header = await repository.create({
          workOrderId: data.workOrderId,
          createdByUserId: userId,
          idempotencyKey: key,
          requestHash,
        });
        if (!header) {
          const previous = await repository.findByKey(userId, key);
          if (!previous || previous.requestHash !== requestHash)
            throw new ConflictException(
              'This Idempotency-Key was used for a different allocation.',
            );
          return this.detail(repository, tx, previous);
        }
        const configured = await this.configureDraft(tx, data);
        await repository.replacePlan(header.id, configured);
        // Drafts stay out of history, which begins at confirmation.
        return this.detail(
          repository,
          tx,
          await repository.saveSettings(header.id, configured.settings),
        );
      }),
    );
  }

  updateDraft(id: string, revision: number, data: AllocationDraftInput) {
    return allocationOperation(() =>
      this.repository.withTransaction(async (repository, tx) => {
        const previous = requireDraftRevision(
          await repository.findById(id, true),
          revision,
        );
        const configured = await this.configureDraft(
          tx,
          data,
          previous.settings,
        );
        await repository.replacePlan(id, configured);
        const header = await repository.update(id, {
          workOrderId: data.workOrderId,
          settings: configured.settings,
        });
        return this.detail(repository, tx, header);
      }),
    );
  }

  deleteDraft(id: string, revision: number) {
    return allocationOperation(() =>
      this.repository.withTransaction(async (repository) => {
        requireDraftRevision(await repository.findById(id, true), revision);
        await repository.delete(id);
      }),
    );
  }

  submitDraft(id: string, revision: number, userId: string) {
    return allocationOperation(() =>
      this.repository.withTransaction(async (repository, tx) => {
        const header = await repository.findById(id, true);
        if (!header) throw new NotFoundException('Allocation not found.');
        // Match the submitted draft revision before lifecycle checks so a lost
        // response can be retried without reserving fabric again.
        if (!header.isDraft && header.submittedDraftRevision === revision)
          return this.detail(repository, tx, header);
        requireDraftRevision(header, revision);
        // As the draft reads: assignments of blinds since taken off the order
        // are gone, which leaves the plan incomplete or short.
        const saved = await this.formData(repository, tx, header);
        const input = createAllocationSchema.safeParse({
          workOrderId: header.workOrderId,
          // Stored cut lengths are re-derived from the order's blinds.
          plan: {
            cuts: saved.plan.cuts.map(({ stockItemId, items }) => ({
              stockItemId,
              items,
            })),
          },
        });
        if (!input.success)
          throw new BadRequestException({
            message: 'Complete all allocation fields before submitting.',
            issues: input.error.issues,
          });
        return this.confirmPlan(
          repository,
          tx,
          header,
          input.data.plan,
          true,
          userId,
        );
      }),
    );
  }

  /**
   * A draft plans the blinds its order has now, read without the order's
   * lock: it claims nothing, and confirmation reads them again under it.
   */
  private async configureDraft(
    tx: DatabaseTransaction,
    data: AllocationDraftInput,
    settings?: AllocationRecord['settings'],
  ) {
    const { lines } = await this.orders.lines(tx, data.workOrderId);
    requireOrderLines(lines, data.plan);
    return this.configure(lines, data.plan, settings);
  }

  private async confirmPlan(
    repository: AllocationsRepository,
    tx: DatabaseTransaction,
    header: AllocationRecord,
    plan: CreateAllocation['plan'],
    fromDraft: boolean,
    userId: string,
  ) {
    // The order's allocated_at mirrors this allocation's confirmed_at.
    const now = new Date();
    const { lines, change: order } = await this.orders.allocate(
      tx,
      header.workOrderId,
      now,
    );
    requireOrderLines(lines, plan);
    // A submitted draft keeps the rules it was planned with.
    const input = this.configure(lines, plan, header.settings);
    const summary = await this.validateForWrite(
      repository,
      tx,
      input,
      header.id,
    );
    await repository.replacePlan(header.id, input, summary);
    const saved = fromDraft
      ? await repository.update(header.id, {
          isDraft: false,
          confirmedAt: now,
          submittedDraftRevision: header.revision,
          settings: input.settings,
          plannedSummary: summary,
        })
      : await repository.initializePlan(
          header.id,
          input.settings,
          summary,
          now,
        );
    const result = await this.detail(repository, tx, saved);
    await this.audit.record(tx, userId, 'allocation.confirmed', [
      {
        recordType: 'allocations',
        recordId: header.id,
        // The draft it may have come from is not part of its history.
        before: null,
        after: { type: 'allocations', value: result },
      },
      order,
    ]);
    return result;
  }

  replace(id: string, input: ReplaceAllocation, userId: string) {
    return allocationOperation(() =>
      this.repository.withTransaction(async (repository, tx) => {
        const header = requireActiveRevision(
          await repository.findById(id, true),
          input.expectedRevision,
        );
        await this.orders.assertPlanningAllowed(tx, header.workOrderId);
        await this.worksheets.assertPlanMutable(tx, id);
        const before = await this.detail(repository, tx, header);
        // The order lock above prevents a production completion during replanning.
        // Its blinds remain fixed; replanning does not change its milestones.
        const { lines } = await this.orders.lines(tx, header.workOrderId);
        requireOrderLines(lines, input.plan);
        const configured = this.configure(lines, input.plan, header.settings);
        const current = await repository.items(id);
        const summary = await this.validateForWrite(
          repository,
          tx,
          configured,
          header.id,
          current.map((item) => item.stockItemId!),
        );
        await repository.replacePlan(id, configured, summary);
        const saved = await repository.update(id, {
          settings: configured.settings,
          plannedSummary: summary,
        });
        const result = await this.detail(repository, tx, saved);
        await this.audit.record(tx, userId, 'allocation.replaced', [
          {
            recordType: 'allocations',
            recordId: id,
            before: { type: 'allocations', value: before },
            after: { type: 'allocations', value: result },
          },
        ]);
        return result;
      }),
    );
  }

  cancel(id: string, revision: number, userId: string) {
    return allocationOperation(() =>
      this.repository.withTransaction(async (repository, tx) => {
        const header = await repository.findById(id, true);
        if (!header) throw new NotFoundException('Allocation not found.');
        if (header.cancelledAt) return this.detail(repository, tx, header);
        requireActiveRevision(header, revision);
        await this.worksheets.assertPlanMutable(tx, id);
        const order = await this.orders.release(tx, header.workOrderId);
        const items = await repository.items(id);
        await this.stockItems.findForAllocation(tx, {
          stockIds: items.map((item) => item.stockItemId!),
          lock: true,
        });
        const before = await this.detail(repository, tx, header);
        const result = await this.detail(
          repository,
          tx,
          await repository.update(id, {
            cancelledAt: new Date(),
          }),
        );
        await this.audit.record(tx, userId, 'allocation.cancelled', [
          {
            recordType: 'allocations',
            recordId: id,
            before: { type: 'allocations', value: before },
            after: { type: 'allocations', value: result },
          },
          order,
        ]);
        return result;
      }),
    );
  }

  complete(
    id: string,
    request: CompleteAllocationRequest,
    userId: string,
    key: string,
    transaction?: DatabaseTransaction,
    worksheetId?: string,
  ) {
    const requestHash = hash(request);
    const operation = async (
      repository: AllocationsRepository,
      tx: DatabaseTransaction,
    ) => {
      const header = await repository.findById(id, true);
      if (!header) throw new NotFoundException('Allocation not found.');
      // Completion changes stock and creates remnants. Check its replay identity
      // before checking the active revision, which the original commit advanced.
      if (
        header.completedAt &&
        header.completionKey === key &&
        header.completion?.submittedByUserId === userId
      ) {
        if (header.completionRequestHash !== requestHash)
          throw new ConflictException(
            'This completion key was used with different results.',
          );
        return this.detail(repository, tx, header);
      }
      await this.worksheets.assertReconciliationAllowed(tx, id, worksheetId);
      const parsed = completeAllocationSchema.safeParse(request);
      if (!parsed.success)
        throw new ConflictException(
          'Refresh stock revisions before submitting cutting results. Older requests may only replay a completed submission.',
        );
      const input = parsed.data;
      requireActiveRevision(header, input.expectedRevision);
      const allocated = await repository.items(id);
      const ids = allocated.map((item) => item.stockItemId!);
      if (
        new Set(input.items.map((item) => item.stockItemId)).size !==
          input.items.length ||
        input.items.length !== ids.length ||
        input.items.some((item) => !ids.includes(item.stockItemId))
      )
        throw new BadRequestException(
          'Provide exactly one cutting result for every allocated stock item.',
        );
      // Inventory reconciliation is independent of the cutting milestone.
      const now = new Date();
      await this.stockItems.findForAllocation(tx, {
        stockIds: ids,
        lock: true,
      });
      if (!worksheetId)
        await this.worksheets.assertStockReconciliationAllowed(tx, ids);
      const before = await this.detail(repository, tx, header);
      const effects = await this.stockItems.recordCuttingResults(
        input.items,
        tx,
        now,
      );
      let saved = await repository.update(id, {
        stockEffects: effects,
        completedAt: now,
        completionKey: key,
        completionRequestHash: requestHash,
        completion: {
          submittedByUserId: userId,
          items: input.items,
          createdStockItemIds: effects
            .filter((e) => !e.before)
            .map((e) => e.stockItemId),
          affectedAllocationIds: [],
        },
      });
      // Retire this order's reservations before looking for shortages in the
      // remaining orders; observed measurements are kept even if stock is short.
      const affectedAllocationIds = await repository.affectedAllocations(ids);
      saved = await repository.saveCompletionFlags(id, {
        ...saved.completion!,
        affectedAllocationIds,
      });
      const result = await this.detail(repository, tx, saved);
      await this.audit.record(tx, userId, 'allocation.completed', [
        {
          recordType: 'allocations',
          recordId: id,
          before: { type: 'allocations', value: before },
          after: { type: 'allocations', value: result },
        },
        ...stockChanges(effects),
      ]);
      return result;
    };
    return allocationOperation(() =>
      this.repository.withTransaction(operation, false, transaction),
    );
  }

  lockForWorksheet(tx: DatabaseTransaction, id: string) {
    return this.repository.withTransaction(
      async (repository) => {
        const row = await repository.findById(id, true);
        if (!row) throw new NotFoundException('Allocation not found.');
        return row;
      },
      false,
      tx,
    );
  }

  lockForCutting(tx: DatabaseTransaction, orderId: string) {
    return this.repository.withTransaction(
      async (repository) => {
        const row = await repository.liveForOrder(orderId);
        if (!row)
          throw new ConflictException('Allocate this order before cutting.');
        return this.lockForWorksheet(tx, row.id);
      },
      false,
      tx,
    );
  }

  worksheetSnapshot(tx: DatabaseTransaction, id: string) {
    return this.repository.withTransaction(
      async (repository) => {
        const header = await repository.findById(id, true);
        if (!header) throw new NotFoundException('Allocation not found.');
        requireActiveRevision(header, header.revision);
        return allocationDetailSchema.parse(
          await this.detail(repository, tx, header),
        );
      },
      false,
      tx,
    );
  }

  correctionContext(id: string) {
    return allocationOperation(() =>
      this.repository.withTransaction(async (repository, tx) => {
        const header = await repository.findById(id);
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
          record: await this.detail(repository, tx, header),
          baselineAvailable: header.stockEffects !== null,
          effects,
          stockItems: await this.stockItems.findForAllocation(tx, {
            stockIds: ids,
          }),
          eligibility: await this.stockItems.eligibility(tx, effects, ids, id),
        });
      }, true),
    );
  }

  correctCompletion(
    id: string,
    input: CompletionCorrection,
    userId: string,
    key: string,
  ) {
    return allocationOperation(() =>
      this.repository.withTransaction(async (repository, tx) => {
        const header = await repository.findById(id, true);
        if (!header) throw new NotFoundException('Allocation not found.');
        const audit = this.audit;
        const replay = await audit.replay(
          tx,
          userId,
          'allocation.correct-completion',
          id,
          key,
          input,
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
        const selectedIds = input.items.map((i) => i.outcome.stockItemId);
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
            !header.completion!.items.some(
              (i) => i.stockItemId === source.stockItemId,
            )
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
        const familyIds = families.flatMap((f) => [
          f.source.stockItemId,
          ...f.pieces.map((p) => p.stockItemId),
        ]);
        const rows = await this.stockItems.lockForCorrection(tx, familyIds);
        await this.stockItems.requireCorrectionEligible(
          tx,
          header.stockEffects,
          input.stockVersions,
          familyIds,
          id,
        );
        const current = new Map(rows.map((r) => [r.id, r]));
        const before = await this.detail(repository, tx, header);
        const effects: StockEffect[] = [];
        const effective = structuredClone(
          header.effectiveCompletion ?? header.completion,
        );
        for (const { item, source, pieces } of families) {
          const sourceBefore = source.before!;
          const actual = current.get(source.stockItemId)!;
          if (item.outcome.expectedRevision !== actual.revision)
            throw new ConflictException(
              'Stock changed; refresh before correcting.',
            );
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
            header.completedAt,
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
            pieces.some(
              (piece) => !identifiedPieceIds.includes(piece.stockItemId),
            )
          )
            throw new BadRequestException(
              'Keep or explicitly select every existing retained piece for voiding.',
            );
          const pending: Parameters<StockItemsService['applySnapshots']>[1] =
            [];
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
          const applied = await this.stockItems.applySnapshots(tx, pending);
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
          await repository.affectedAllocations(familyIds);
        const saved = await repository.update(id, {
          stockEffects: [...baseline.values()],
          effectiveCompletion: effective,
          correctedAt: new Date(),
        });
        const result = await this.detail(repository, tx, saved);
        const eventId = await audit.record(
          tx,
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
          tx,
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

  list(query: AllocationQuery) {
    return allocationOperation(() =>
      this.repository.withTransaction(async (repository) => {
        const result = await repository.list(query);
        const affected = new Set(
          await repository.affectedAllocations(
            undefined,
            result.items.map((item) => item.id),
          ),
        );
        return {
          ...result,
          items: result.items.map((row) =>
            allocationSummary(row, affected.has(row.id)),
          ),
        };
      }, true),
    );
  }
  findById(id: string) {
    return allocationOperation(() =>
      this.repository.withTransaction(async (repository, tx) => {
        const header = await repository.findById(id);
        if (!header) throw new NotFoundException('Allocation not found.');
        return this.detail(repository, tx, header);
      }, true),
    );
  }

  // Cutting rules and cut lengths are server-derived on every write, so a
  // draft, submission, or edit never carries client-authored lengths.
  private configure<C extends { items: { requirementId: string }[] }>(
    lines: Line[],
    plan: { cuts: C[] },
    saved?: Parameters<CuttingRulesService['apply']>[1],
  ) {
    const rules = this.cuttingRules.apply(requirementsOf(lines), saved);
    return { ...rules, plan: planCutLengths(rules.requirements, plan) };
  }

  private async validateForWrite(
    repository: AllocationsRepository,
    tx: DatabaseTransaction,
    input: ConfiguredAllocationPlan,
    excludeId?: string,
    previousIds: string[] = [],
  ) {
    await this.stockItems.requireColors(
      input.requirements.map((item) => item.fabricColorId),
      tx,
    );
    const selected = [
      ...new Set(input.plan.cuts.map((cut) => cut.stockItemId)),
    ];
    // Replanning releases old stock as well as claiming new stock. Lock their
    // union before excluding this order's existing reservation from availability.
    const locked = await this.stockItems.findForAllocation(tx, {
      stockIds: [...new Set([...selected, ...previousIds])],
      lock: true,
    });
    if (selected.some((id) => !locked.some((stock) => stock.id === id)))
      throw new NotFoundException('A selected stock item does not exist.');
    const reservations = await repository.reservations(selected, excludeId);
    const result = validateCuttingPlan(
      buildCuttingContext(
        input,
        locked.filter((stock) => selected.includes(stock.id)),
        reservations,
      ),
      input.plan,
    );
    if (!result.valid) {
      const conflict = result.issues.some((issue) =>
        [
          'voided_stock',
          'consumed_stock',
          'reserved_remnant',
          'length_capacity',
        ].includes(issue.code),
      );
      const error = {
        message: conflict
          ? 'Stock availability changed or is insufficient.'
          : 'Cutting plan is invalid.',
        issues: result.issues,
      };
      if (conflict) throw new ConflictException(error);
      throw new BadRequestException(error);
    }
    // SQL numeric(12,3) must be able to store the validator's aggregate reservation.
    if (
      result.summary.reservations.some(
        (item) => toLengthUnits(item.reservedLengthMm) > 999999999999n,
      )
    )
      throw new BadRequestException(
        'Reservation exceeds the supported stock range.',
      );
    return result.summary;
  }

  /**
   * A draft reads with the blinds its order has now. An assignment of a
   * blind since taken off the order is left out, so the draft opens, shows
   * what is unplanned, and cannot be confirmed until that is planned again.
   */
  private async formData(
    repository: AllocationsRepository,
    tx: DatabaseTransaction,
    header: AllocationRecord,
  ) {
    const { lines } = await this.orders.lines(tx, header.workOrderId);
    const onOrder = new Set(lines.map((line) => line.id));
    const plan = await repository.plan(header.id);
    return allocationDraftDataSchema.parse({
      requirements: this.cuttingRules.apply(
        requirementsOf(lines),
        header.settings,
      ).requirements,
      settings: header.settings ?? {},
      plan: {
        cuts: plan.cuts.map((cut) => ({
          ...cut,
          items: cut.items.filter((item) => onOrder.has(item.requirementId)),
        })),
      },
    });
  }

  private async detail(
    repository: AllocationsRepository,
    tx: DatabaseTransaction,
    header: AllocationRecord,
  ) {
    if (header.isDraft)
      return allocationDraftSchema.parse({
        ...allocationSummary(header, false),
        data: await this.formData(repository, tx, header),
      });
    const items = await repository.items(header.id);
    const stock = await this.stockItems.findForAllocation(tx, {
      stockIds: items.map((item) => item.stockItemId!),
    });
    const byId = new Map(stock.map((item) => [item.id, item]));
    const affected = await repository.affectedAllocations(undefined, [
      header.id,
    ]);
    // A confirmed plan assigns every blind its order had, and they are fixed
    // while it is live, so the blinds its cuts point at are the blinds it was
    // made for, even after a cancelled order's blinds change.
    const plan = await repository.plan(header.id);
    const lines = await this.orders.linesById(tx, [
      ...new Set(
        plan.cuts.flatMap((cut) => cut.items.map((item) => item.requirementId)),
      ),
    ]);
    return allocationDetailSchema.parse({
      ...allocationSummary(header, affected.length > 0),
      requirements: this.cuttingRules.apply(
        requirementsOf(lines),
        header.settings,
      ).requirements,
      plan,
      settings: header.settings,
      plannedSummary: header.plannedSummary,
      completion: header.effectiveCompletion ?? header.completion,
      correctedAt: header.correctedAt?.toISOString() ?? null,
      items: items.map((item) => ({
        ...item,
        reservedLengthMm: Number(item.reservedLengthMm),
        stockItem: byId.get(item.stockItemId!),
      })),
    });
  }
}
