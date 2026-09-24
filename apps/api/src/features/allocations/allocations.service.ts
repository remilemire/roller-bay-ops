import {
  orderCancellationContextSchema,
  type OrderCancellation,
} from '@roller-bay/shared/work-orders';
import type { AuditChange } from '@roller-bay/shared/audit';
import type { WorkOrderRecord } from '../work-orders/work-orders.repository.js';
import { presentWorkOrder } from '../work-orders/work-orders.presenter.js';
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
import { stockChanges } from '../stock-items/stock-items.audit.js';
/**
 * Reservation-changing writes lock the allocation header, then its work
 * order, then stock in a common order before checking availability.
 *
 * The blinds a plan assigns are the work order's. This service reads them
 * through WorkOrdersService and maintains only the allocation timestamp.
 * Production milestones are recorded independently.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  allocationDetailSchema,
  allocationDraftDataSchema,
  allocationDraftSchema,
  completeAllocationSchema,
  createAllocationSchema,
  type AllocationDetail,
  type AllocationCancellation,
  type AllocationDraftInput,
  type AllocationQuery,
  type CompleteAllocationRequest,
  type CreateAllocation,
  type ReplaceAllocation,
} from '@roller-bay/shared/allocations';
import { createHash } from 'node:crypto';
import { StockCorrectionsService } from '../stock-items/stock-corrections.service.js';
import { StockItemsService } from '../stock-items/stock-items.service.js';
import { WorkOrdersService } from '../work-orders/work-orders.service.js';
import { buildCuttingContext } from './allocation-cutting-context.js';
import {
  requireActiveRevision,
  requireDraftRevision,
} from './allocation.rules.js';
import { allocationOperation } from './allocations.operation.js';
import { allocationSummary } from './allocations.presenter.js';
import { type AllocationRecord } from './allocations.repository.js';
import { toLengthUnits } from './cutting-plan/cutting-dimensions.js';
import { validateCuttingPlan } from './cutting-plan/cutting-plan.validator.js';
import {
  CuttingRulesService,
  planCutLengths,
  type ConfiguredAllocationPlan,
} from './cutting-rules.service.js';
type Line = Awaited<ReturnType<WorkOrdersService['linesById']>>[number];
type Plan = {
  cuts: {
    items: {
      requirementId: string;
    }[];
  }[];
};
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
    private readonly unitOfWork: UnitOfWork,
    private readonly worksheets: CuttingWorksheetsService,
    private readonly audit: AuditService,
    private readonly stockItems: StockItemsService,
    private readonly stockCorrections: StockCorrectionsService,
    private readonly cuttingRules: CuttingRulesService,
    private readonly orders: WorkOrdersService,
  ) {}
  create(input: CreateAllocation, userId: string, key: string) {
    const requestHash = hash(input);
    return allocationOperation(() =>
      this.unitOfWork.transaction(async (context) => {
        const header = await context.allocations.create({
          workOrderId: input.workOrderId,
          createdByUserId: userId,
          idempotencyKey: key,
          requestHash,
        });
        if (!header) {
          const previous = await context.allocations.findByKey(userId, key);
          if (!previous || previous.requestHash !== requestHash)
            throw new ConflictException(
              'This Idempotency-Key was used for a different allocation.',
            );
          return this.detail(context, previous);
        }
        return this.confirmPlan(context, header, input.plan, false, userId);
      }),
    );
  }
  createDraft(data: AllocationDraftInput, userId: string, key: string) {
    const requestHash = hash({ mode: 'draft', data });
    return allocationOperation(() =>
      this.unitOfWork.transaction(async (context) => {
        const header = await context.allocations.create({
          workOrderId: data.workOrderId,
          createdByUserId: userId,
          idempotencyKey: key,
          requestHash,
        });
        if (!header) {
          const previous = await context.allocations.findByKey(userId, key);
          if (!previous || previous.requestHash !== requestHash)
            throw new ConflictException(
              'This Idempotency-Key was used for a different allocation.',
            );
          return this.detail(context, previous);
        }
        const configured = await this.configureDraft(context, data);
        await context.allocations.replacePlan(header.id, configured);
        // Drafts stay out of history, which begins at confirmation.
        return this.detail(
          context,
          await context.allocations.saveSettings(
            header.id,
            configured.settings,
          ),
        );
      }),
    );
  }
  updateDraft(id: string, revision: number, data: AllocationDraftInput) {
    return allocationOperation(() =>
      this.unitOfWork.transaction(async (context) => {
        const previous = requireDraftRevision(
          await context.allocations.findById(id, true),
          revision,
        );
        const configured = await this.configureDraft(
          context,
          data,
          previous.settings,
        );
        await context.allocations.replacePlan(id, configured);
        const header = await context.allocations.update(id, {
          workOrderId: data.workOrderId,
          settings: configured.settings,
        });
        return this.detail(context, header);
      }),
    );
  }
  deleteDraft(id: string, revision: number) {
    return allocationOperation(() =>
      this.unitOfWork.transaction(async (context) => {
        requireDraftRevision(
          await context.allocations.findById(id, true),
          revision,
        );
        await context.allocations.delete(id);
      }),
    );
  }
  submitDraft(id: string, revision: number, userId: string) {
    return allocationOperation(() =>
      this.unitOfWork.transaction(async (context) => {
        const header = await context.allocations.findById(id, true);
        if (!header) throw new NotFoundException('Allocation not found.');
        // Match the submitted draft revision before lifecycle checks so a lost
        // response can be retried without reserving fabric again.
        if (!header.isDraft && header.submittedDraftRevision === revision)
          return this.detail(context, header);
        requireDraftRevision(header, revision);
        // As the draft reads: assignments of blinds since taken off the order
        // are gone, which leaves the plan incomplete or short.
        const saved = await this.formData(context, header);
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
        return this.confirmPlan(context, header, input.data.plan, true, userId);
      }),
    );
  }
  /**
   * Draft writes share the order lock with cancellation. They claim no stock;
   * confirmation still validates the plan against current inventory.
   */
  private async configureDraft(
    context: UnitOfWorkContext,
    data: AllocationDraftInput,
    settings?: AllocationRecord['settings'],
  ) {
    const order = await this.orders.requireOrder(context, data.workOrderId);
    this.orders.assertNotCancelled(order);
    const { lines } = await this.orders.lines(context, data.workOrderId);
    requireOrderLines(lines, data.plan);
    return this.configure(lines, data.plan, settings);
  }
  private async confirmPlan(
    context: UnitOfWorkContext,
    header: AllocationRecord,
    plan: CreateAllocation['plan'],
    fromDraft: boolean,
    userId: string,
  ) {
    // The order's allocated_at mirrors this allocation's confirmed_at.
    const now = new Date();
    const { lines, change: order } = await this.orders.allocate(
      context,
      header.workOrderId,
      now,
    );
    requireOrderLines(lines, plan);
    // A submitted draft keeps the rules it was planned with.
    const input = this.configure(lines, plan, header.settings);
    const summary = await this.validateForWrite(context, input, header.id);
    await context.allocations.replacePlan(header.id, input, summary);
    const saved = fromDraft
      ? await context.allocations.update(header.id, {
          isDraft: false,
          confirmedAt: now,
          submittedDraftRevision: header.revision,
          settings: input.settings,
          plannedSummary: summary,
        })
      : await context.allocations.initializePlan(
          header.id,
          input.settings,
          summary,
          now,
        );
    const result = await this.detail(context, saved);
    await this.audit.record(context, userId, 'allocation.confirmed', [
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
      this.unitOfWork.transaction(async (context) => {
        const header = requireActiveRevision(
          await context.allocations.findById(id, true),
          input.expectedRevision,
        );
        await this.orders.assertPlanningAllowed(context, header.workOrderId);
        await this.worksheets.assertPlanMutable(context, id);
        const before = await this.detail(context, header);
        // The order lock above prevents a production completion during replanning.
        // Its blinds remain fixed; replanning does not change its milestones.
        const { lines } = await this.orders.lines(context, header.workOrderId);
        requireOrderLines(lines, input.plan);
        const configured = this.configure(lines, input.plan, header.settings);
        const current = await context.allocations.items(id);
        const summary = await this.validateForWrite(
          context,
          configured,
          header.id,
          current.map((item) => item.stockItemId!),
        );
        await context.allocations.replacePlan(id, configured, summary);
        const saved = await context.allocations.update(id, {
          settings: configured.settings,
          plannedSummary: summary,
        });
        const result = await this.detail(context, saved);
        await this.audit.record(context, userId, 'allocation.replaced', [
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
      this.unitOfWork.transaction(async (context) => {
        const header = await context.allocations.findById(id, true);
        if (!header) throw new NotFoundException('Allocation not found.');
        if (header.cancelledAt) return this.detail(context, header);
        requireActiveRevision(header, revision);
        await this.worksheets.assertPlanMutable(context, id);
        const order = await this.orders.release(context, header.workOrderId);
        const items = await context.allocations.items(id);
        await this.stockItems.findForAllocation(context, {
          stockIds: items.map((item) => item.stockItemId!),
          lock: true,
        });
        const before = await this.detail(context, header);
        const result = await this.detail(
          context,
          await context.allocations.update(id, {
            cancelledAt: new Date(),
          }),
        );
        await this.audit.record(context, userId, 'allocation.cancelled', [
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
  cancellationContext(id: string) {
    return allocationOperation(() =>
      this.unitOfWork.readOnlyTransaction(async (context) => {
        const allocation = await context.allocations.findById(id);
        if (!allocation) throw new NotFoundException('Allocation not found.');
        const preview = await this.cancellationContextForOrder(
          context,
          allocation.workOrderId,
        );
        if (preview.allocation?.id !== id)
          throw new ConflictException(
            'This allocation has already been cancelled or released.',
          );
        return preview;
      }),
    );
  }
  async cancellationContextForOrder(
    context: UnitOfWorkContext,
    orderId: string,
  ) {
    const order = await this.orders.requireOrder(context, orderId, false);
    const live = await context.allocations.liveForOrder(orderId);
    const allocation = live
      ? await context.allocations.findById(live.id)
      : null;
    const worksheet = allocation
      ? await context.cuttingWorksheets.forAllocation(allocation.id)
      : null;
    return orderCancellationContextSchema.parse({
      order: presentWorkOrder(order),
      allocation: allocation
        ? {
            id: allocation.id,
            revision: allocation.revision,
            completedAt: allocation.completedAt?.toISOString() ?? null,
          }
        : null,
      worksheet:
        worksheet && !worksheet.reviewedAt
          ? {
              id: worksheet.id,
              revision: worksheet.revision,
              submittedAt: worksheet.submittedAt?.toISOString() ?? null,
            }
          : null,
      outstandingCuttingResults:
        !!allocation &&
        !allocation.completedAt &&
        !!(worksheet || order.cutAt || order.assembledAt || order.checkedAt),
    });
  }
  async lockOrderForCancellation(context: UnitOfWorkContext, orderId: string) {
    // Allocation -> order matches confirmation and cutting. Recheck the live
    // association after locking the order, including previews with no allocation.
    const initial = await context.allocations.liveForOrder(orderId);
    const allocation = initial
      ? await this.lockAllocation(context, initial.id)
      : null;
    const order = await this.orders.requireOrder(context, orderId);

    const live = await context.allocations.liveForOrder(orderId);
    if ((initial?.id ?? null) !== (live?.id ?? null))
      throw new ConflictException(
        'The allocation changed. Review cancellation again.',
      );
    return { order, allocation };
  }
  async cancelForOrder(
    context: UnitOfWorkContext,
    order: WorkOrderRecord,
    allocation: AllocationRecord | null,
    input: OrderCancellation,
  ) {
    if (
      order.revision !== input.expectedRevision ||
      (allocation?.id ?? null) !== input.allocationId ||
      (allocation?.revision ?? null) !== input.expectedAllocationRevision
    )
      throw new ConflictException(
        'The order or allocation changed. Review cancellation again.',
      );
    this.orders.assertNotCancelled(order);
    if (order.shippedAt)
      throw new ConflictException(
        'Shipped orders cannot be cancelled or released.',
      );
    const found = allocation
      ? await context.cuttingWorksheets.forAllocation(allocation.id)
      : null;
    const sheet =
      found && !found.reviewedAt
        ? await this.worksheets.requireRecord(context, found.id, true)
        : null;
    if (
      (sheet?.id ?? null) !== input.worksheetId ||
      (sheet?.revision ?? null) !== input.expectedWorksheetRevision
    )
      throw new ConflictException(
        'Cutting results changed. Refresh the cancellation form.',
      );

    const outstanding =
      !!allocation &&
      !allocation.completedAt &&
      !!(sheet || order.cutAt || order.assembledAt || order.checkedAt);
    if (outstanding && !input.skipCuttingResults)
      throw new ConflictException(
        'Resolve outstanding cutting results or explicitly continue without recording them.',
      );
    const changes: AuditChange[] = [];
    if (sheet)
      changes.push(
        await this.worksheets.closeWithoutReconciliation(context, sheet),
      );
    if (allocation)
      changes.push(await this.releaseAllocation(context, allocation.id));
    return { changes, skippedResults: outstanding };
  }
  cancelReviewed(
    id: string,
    input: AllocationCancellation,
    actor: string,
    key: string,
  ) {
    return allocationOperation(() =>
      this.unitOfWork.transaction(async (context) => {
        const initial = await context.allocations.findById(id);
        if (!initial) throw new NotFoundException('Allocation not found.');
        const { order, allocation } = await this.lockOrderForCancellation(
          context,
          initial.workOrderId,
        );
        const scope = 'allocation.cancel-reviewed';
        const replay = await this.audit.replay(
          context,
          actor,
          scope,
          id,
          key,
          input,
        );
        if (replay.result) return replay.result;
        if (input.allocationId !== id)
          throw new ConflictException(
            'The allocation changed. Review cancellation again.',
          );
        const { changes, skippedResults } = await this.cancelForOrder(
          context,
          order,
          allocation,
          input,
        );
        const result = await this.orders.recordAllocationRelease(
          context,
          order,
        );
        changes.unshift(result.change);
        const eventId = await this.audit.record(
          context,
          actor,
          skippedResults
            ? 'allocation.cancelled.results-skipped'
            : 'allocation.cancelled',
          changes,
          input.reason,
        );
        return this.audit.remember(
          context,
          actor,
          scope,
          id,
          key,
          replay.requestHash,
          {
            eventId,
            recordId: id,
            revision: (await context.allocations.findById(id))!.revision,
            affectedAllocationIds: [id],
            createdStockItemIds: [],
          },
        );
      }),
    );
  }
  /** Completed allocations leave the live slot without reversing their stock effects. */
  private async releaseAllocation(context: UnitOfWorkContext, id: string) {
    const header = await context.allocations.findById(id, true);
    if (!header || header.isDraft || header.cancelledAt || header.releasedAt)
      throw new ConflictException(
        'The order allocation changed; refresh before continuing.',
      );
    const items = await context.allocations.items(id);
    await this.stockItems.findForAllocation(context, {
      stockIds: items.map((i) => i.stockItemId!),
      lock: true,
    });
    const before = allocationDetailSchema.parse(
      await this.detail(context, header),
    );
    const saved = await context.allocations.update(
      id,
      header.completedAt
        ? { releasedAt: new Date() }
        : { cancelledAt: new Date() },
    );
    return {
      recordType: 'allocations' as const,
      recordId: id,
      before: { type: 'allocations' as const, value: before },
      after: {
        type: 'allocations' as const,
        value: allocationDetailSchema.parse(await this.detail(context, saved)),
      },
    };
  }
  complete(
    id: string,
    request: CompleteAllocationRequest,
    userId: string,
    key: string,
  ) {
    return allocationOperation(() =>
      this.unitOfWork.transaction((context) =>
        this.completeInTransaction(context, id, request, userId, key),
      ),
    );
  }
  /** Reuse the caller's transaction so worksheet review and stock reconciliation commit together. */
  completeInTransaction(
    context: UnitOfWorkContext,
    id: string,
    request: CompleteAllocationRequest,
    userId: string,
    key: string,
    worksheetId?: string,
  ) {
    return allocationOperation(async () => {
      const requestHash = hash(request);
      const header = await context.allocations.findById(id, true);
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
        return this.detail(context, header);
      }
      await this.worksheets.assertReconciliationAllowed(
        context,
        id,
        worksheetId,
      );
      const parsed = completeAllocationSchema.safeParse(request);
      if (!parsed.success)
        throw new ConflictException(
          'Refresh stock revisions before submitting cutting results. Older requests may only replay a completed submission.',
        );
      const input = parsed.data;
      requireActiveRevision(header, input.expectedRevision);
      const allocated = await context.allocations.items(id);
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
      await this.stockItems.findForAllocation(context, {
        stockIds: ids,
        lock: true,
      });
      if (!worksheetId)
        await this.worksheets.assertStockReconciliationAllowed(context, ids);
      const before = await this.detail(context, header);
      const effects = await this.stockItems.recordCuttingResults(
        input.items,
        context,
        now,
      );
      let saved = await context.allocations.update(id, {
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
      const affectedAllocationIds =
        await context.allocations.affectedAllocations(ids);
      saved = await context.allocations.saveCompletionFlags(id, {
        ...saved.completion!,
        affectedAllocationIds,
      });
      const result = await this.detail(context, saved);
      await this.audit.record(context, userId, 'allocation.completed', [
        {
          recordType: 'allocations',
          recordId: id,
          before: { type: 'allocations', value: before },
          after: { type: 'allocations', value: result },
        },
        ...stockChanges(effects),
      ]);
      return result;
    });
  }
  async lockAllocation(context: UnitOfWorkContext, id: string) {
    const row = await context.allocations.findById(id, true);
    if (!row) throw new NotFoundException('Allocation not found.');
    return row;
  }
  async lockForCutting(context: UnitOfWorkContext, orderId: string) {
    const row = await context.allocations.liveForOrder(orderId);
    if (!row)
      throw new ConflictException('Allocate this order before cutting.');
    return this.lockAllocation(context, row.id);
  }
  async worksheetSnapshot(context: UnitOfWorkContext, id: string) {
    const header = await context.allocations.findById(id, true);
    if (!header) throw new NotFoundException('Allocation not found.');
    requireActiveRevision(header, header.revision);
    return allocationDetailSchema.parse(await this.detail(context, header));
  }
  correctionContext(id: string) {
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
          record: await this.detail(context, header),
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
  correctCompletion(
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
        const before = await this.detail(context, header);
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
        const result = await this.detail(context, saved);
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
  list(query: AllocationQuery) {
    return allocationOperation(() =>
      this.unitOfWork.readOnlyTransaction(async (context) => {
        const result = await context.allocations.list(query);
        const affected = new Set(
          await context.allocations.affectedAllocations(
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
      }),
    );
  }
  findById(id: string) {
    return allocationOperation(() =>
      this.unitOfWork.readOnlyTransaction(async (context) => {
        const header = await context.allocations.findById(id);
        if (!header) throw new NotFoundException('Allocation not found.');
        return this.detail(context, header);
      }),
    );
  }
  // Cutting rules and cut lengths are server-derived on every write, so a
  // draft, submission, or edit never carries client-authored lengths.
  private configure<
    C extends {
      items: {
        requirementId: string;
      }[];
    },
  >(
    lines: Line[],
    plan: {
      cuts: C[];
    },
    saved?: Parameters<CuttingRulesService['apply']>[1],
  ) {
    const rules = this.cuttingRules.apply(requirementsOf(lines), saved);
    return { ...rules, plan: planCutLengths(rules.requirements, plan) };
  }
  private async validateForWrite(
    context: UnitOfWorkContext,
    input: ConfiguredAllocationPlan,
    excludeId?: string,
    previousIds: string[] = [],
  ) {
    await this.stockItems.requireColors(
      input.requirements.map((item) => item.fabricColorId),
      context,
    );
    const selected = [
      ...new Set(input.plan.cuts.map((cut) => cut.stockItemId)),
    ];
    // Replanning releases old stock as well as claiming new stock. Lock their
    // union before excluding this order's existing reservation from availability.
    const locked = await this.stockItems.findForAllocation(context, {
      stockIds: [...new Set([...selected, ...previousIds])],
      lock: true,
    });
    if (selected.some((id) => !locked.some((stock) => stock.id === id)))
      throw new NotFoundException('A selected stock item does not exist.');
    const reservations = await context.allocations.reservations(
      selected,
      excludeId,
    );
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
  private async formData(context: UnitOfWorkContext, header: AllocationRecord) {
    const { lines } = await this.orders.lines(context, header.workOrderId);
    const onOrder = new Set(lines.map((line) => line.id));
    const plan = await context.allocations.plan(header.id);
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
  private async detail(context: UnitOfWorkContext, header: AllocationRecord) {
    if (header.isDraft)
      return allocationDraftSchema.parse({
        ...allocationSummary(header, false),
        data: await this.formData(context, header),
      });
    const items = await context.allocations.items(header.id);
    const stock = await this.stockItems.findForAllocation(context, {
      stockIds: items.map((item) => item.stockItemId!),
    });
    const byId = new Map(stock.map((item) => [item.id, item]));
    const affected = await context.allocations.affectedAllocations(undefined, [
      header.id,
    ]);
    // A confirmed plan assigns every blind its order had, and they are fixed
    // while it is live, so the blinds its cuts point at are the blinds it was
    // made for, even after a cancelled order's blinds change.
    const plan = await context.allocations.plan(header.id);
    const lines = await this.orders.linesById(context, [
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
