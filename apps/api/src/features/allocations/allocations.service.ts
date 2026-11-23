import {
  orderCancellationContextSchema,
  type OrderCancellation,
} from '@roller-bay/shared/work-orders';
import type { AuditChange } from '@roller-bay/shared/audit';
import {
  type WorkOrderRecord,
  presentWorkOrder,
  WorkOrdersService,
} from '../work-orders/index.js';
import type { UnitOfWorkContext } from '../../unit-of-work/unit-of-work-context.js';
import { UnitOfWork } from '../../unit-of-work/unit-of-work.js';
import { AuditService } from '../audit/index.js';
import { CuttingWorksheetsService } from '../cutting-worksheets/index.js';
import { stockChanges, StockItemsService } from '../stock-items/index.js';
/**
 * Reservation-changing writes lock the allocation header, then its work
 * order, then stock in a common order before checking availability.
 *
 * An allocation holds its own blinds and the plan that cuts them; their
 * quantities must add up to the order's. On the order it maintains only the
 * allocation timestamp. Production milestones are recorded independently.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  allocationDetailSchema,
  completeAllocationSchema,
  createAllocationSchema,
  type AllocationCancellation,
  type AllocationDraftInput,
  type AllocationQuery,
  type CompleteAllocationRequest,
  type CreateAllocation,
  type CuttingContext,
  type ReplaceAllocation,
  requirementInput,
} from '@roller-bay/shared/allocations';
import { CuttingPlanOptimizer } from './optimizer/cutting-plan-optimizer.js';
import { CuttingOptimizationError } from './optimizer/optimization.errors.js';
import { findFeasiblePlan } from './optimizer/feasibility-search.js';
import { recutLayout } from './recut-plan.js';
import { createHash, randomUUID } from 'node:crypto';
import { buildCuttingContext } from './allocation-cutting-context.js';
import { AllocationDetailsService } from './allocation-details.service.js';
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
/**
 * Confirmed blinds must add up to the quantity their order states. Callers
 * hold the order's row lock, which a change of the quantity also takes.
 */
function requireOrderQuantity(
  order: WorkOrderRecord,
  requirements: readonly { quantity: number }[],
) {
  const total = requirements.reduce((sum, item) => sum + item.quantity, 0);
  if (total !== order.quantity)
    throw new BadRequestException({
      message: `The blinds add up to ${total}, but order ${order.orderNumber} has ${order.quantity}.`,
      issues: [
        {
          code: 'order_quantity_mismatch',
          path: ['requirements'],
          message: `Blinds add up to ${total} of ${order.quantity}.`,
        },
      ],
    });
}
const groupedRecutTimeoutMs = 5_000;
const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
@Injectable()
export class AllocationsService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly worksheets: CuttingWorksheetsService,
    private readonly audit: AuditService,
    private readonly stockItems: StockItemsService,
    private readonly cuttingRules: CuttingRulesService,
    private readonly orders: WorkOrdersService,
    private readonly details: AllocationDetailsService,
    private readonly optimizer: CuttingPlanOptimizer,
  ) {}
  private async groupedRecutPlan(context: CuttingContext, signal: AbortSignal) {
    try {
      const result = await findFeasiblePlan(
        this.optimizer.prepare(context),
        signal,
      );
      return result.status === 'feasible' ? result.plan : null;
    } catch (error) {
      if (error instanceof CuttingOptimizationError) {
        if (error.code === 'invalid_input')
          throw new BadRequestException(error.message);
        if (error.code === 'cancelled')
          throw new ConflictException(
            'The grouped layout took too long to check. Select fewer requests.',
          );
      }
      throw error;
    }
  }
  async recutStock(
    context: UnitOfWorkContext,
    sourceId: string,
    blinds: CreateAllocation['requirements'],
    stockItemId?: string,
    partial = false,
  ) {
    const source = await context.allocations.findById(sourceId);
    if (!source) throw new NotFoundException('Original allocation not found.');
    const configured = this.cuttingRules.apply(blinds, source.settings);
    const first = blinds[0]!;
    const stocks = await this.stockItems.findForAllocation(context, {
      colorIds: [first.fabricColorId],
      ...(stockItemId && { stockIds: [stockItemId] }),
    });
    const reserved = await context.allocations.reservations(
      stocks.map((s) => s.id),
    );
    const consumed = await this.worksheets.reportedConsumedStockIds(context);
    const candidates = [];
    const signal = AbortSignal.timeout(groupedRecutTimeoutMs);
    // Identical available rectangles have the same fit, independent of shelf or roll number.
    const fits = new Map<string, boolean>();
    for (const stock of stocks) {
      const held = toLengthUnits(Number(reserved.get(stock.id) ?? 0));
      const available = toLengthUnits(stock.remainingLengthMm) - held;
      if (
        available <= 0n ||
        consumed.has(stock.id) ||
        (stock.isRemnant && held > 0n)
      )
        continue;
      const geometry = `${stock.widthMm}/${available}`;
      let fit = fits.get(geometry);
      if (fit === undefined) {
        if (partial) {
          fit = blinds.some((blind) => {
            const layout = recutLayout(
              stock.widthMm,
              { ...blind, quantity: 1 },
              configured.settings,
            );
            return layout !== null && layout.length <= available;
          });
        } else if (blinds.length === 1) {
          const layout = recutLayout(stock.widthMm, first, configured.settings);
          fit = layout !== null && available >= layout.length;
        } else {
          fit = !!(await this.groupedRecutPlan(
            buildCuttingContext(configured, [stock], reserved),
            signal,
          ));
        }
        fits.set(geometry, fit);
      }
      if (fit)
        candidates.push({
          id: stock.id,
          widthMm: stock.widthMm,
          availableLengthMm: Number(available) / 1000,
          locationLabel: stock.locationLabel,
          isRemnant: stock.isRemnant,
        });
    }
    return candidates;
  }
  private async requireRecutSource(
    context: UnitOfWorkContext,
    sourceId: string,
    workOrderId: string,
  ) {
    const source = await context.allocations.findById(sourceId);
    if (
      !source ||
      source.workOrderId !== workOrderId ||
      source.cancelledAt ||
      source.releasedAt ||
      source.isRecut ||
      source.isDraft
    )
      throw new ConflictException('The original allocation is no longer live.');
    return source;
  }

  async manualRecutPlan(
    context: UnitOfWorkContext,
    sourceId: string,
    workOrderId: string,
    blinds: CreateAllocation['requirements'],
    plan: CreateAllocation['plan'],
    lockStock: boolean,
  ) {
    const source = await this.requireRecutSource(
      context,
      sourceId,
      workOrderId,
    );
    const input = this.configure(blinds, plan, source.settings);
    const summary = await this.validatePlan(context, input, {
      lock: lockStock,
    });
    const consumed = await this.worksheets.reportedConsumedStockIds(context);
    if (plan.cuts.some((cut) => consumed.has(cut.stockItemId)))
      throw new ConflictException(
        'A selected roll was reported consumed. Choose another stock item.',
      );
    return { input, summary };
  }
  async reserveManualRecut(
    context: UnitOfWorkContext,
    sourceId: string,
    workOrderId: string,
    blinds: CreateAllocation['requirements'],
    plan: CreateAllocation['plan'],
    actor: string,
  ) {
    const { input, summary } = await this.manualRecutPlan(
      context,
      sourceId,
      workOrderId,
      blinds,
      plan,
      true,
    );
    // The editor addresses requests by ID. Each allocation keeps independent requirement rows.
    const ids = new Map(blinds.map((b) => [b.id, randomUUID()]));
    const stored = {
      ...input,
      requirements: input.requirements.map((r) => ({
        ...r,
        id: ids.get(r.id)!,
      })),
      plan: {
        cuts: input.plan.cuts.map((c) => ({
          ...c,
          items: c.items.map((i) => ({
            ...i,
            requirementId: ids.get(i.requirementId)!,
          })),
        })),
      },
    };
    return this.saveRecut(context, workOrderId, actor, stored, summary);
  }
  async reserveRecut(
    context: UnitOfWorkContext,
    sourceId: string,
    workOrderId: string,
    blinds: CreateAllocation['requirements'],
    stockItemId: string,
    actor: string,
  ) {
    const source = await this.requireRecutSource(
      context,
      sourceId,
      workOrderId,
    );
    const [stock] = await this.stockItems.findForAllocation(context, {
      stockIds: [stockItemId],
      lock: true,
    });
    if (!stock) throw new NotFoundException('Selected stock not found.');
    if (
      (await this.worksheets.reportedConsumedStockIds(context)).has(stockItemId)
    )
      throw new ConflictException(
        'This stock was reported consumed. Select another roll or remnant.',
      );
    const { requirements, settings } = this.cuttingRules.apply(
      blinds.map((blind) => ({ ...blind, id: randomUUID() })),
      source.settings,
    );
    let cuts: CreateAllocation['plan']['cuts'];
    if (requirements.length === 1) {
      const requirement = requirements[0]!;
      const layout = recutLayout(stock.widthMm, requirement, settings);
      if (!layout)
        throw new BadRequestException(
          'The replacement is wider than the usable fabric.',
        );
      cuts = Array.from({ length: layout.rows }, (_, i) => ({
        stockItemId,
        items: [
          {
            requirementId: requirement.id,
            quantity: Math.min(
              layout.across,
              requirement.quantity - i * layout.across,
            ),
          },
        ],
      }));
    } else {
      const reserved = await context.allocations.reservations([stockItemId]);
      if (Number(reserved.get(stockItemId) ?? 0) >= stock.remainingLengthMm)
        throw new ConflictException(
          'The selected stock has no available length.',
        );
      const plan = await this.groupedRecutPlan(
        buildCuttingContext({ requirements, settings }, [stock], reserved),
        AbortSignal.timeout(groupedRecutTimeoutMs),
      );
      if (!plan)
        throw new ConflictException(
          'The selected stock cannot fit all selected recuts.',
        );
      cuts = plan.cuts;
    }
    const input = {
      requirements,
      settings,
      plan: planCutLengths(requirements, { cuts }),
    };
    const summary = await this.validateForWrite(context, input);
    return this.saveRecut(context, workOrderId, actor, input, summary);
  }
  private async saveRecut(
    context: UnitOfWorkContext,
    workOrderId: string,
    actor: string,
    input: ConfiguredAllocationPlan,
    summary: NonNullable<AllocationRecord['plannedSummary']>,
  ) {
    const header = (await context.allocations.create({
      workOrderId,
      createdByUserId: actor,
      isRecut: true,
    }))!;
    await context.allocations.replacePlan(header.id, input, summary);
    await context.allocations.initializePlan(
      header.id,
      input.settings,
      summary,
      new Date(),
    );
    return header.id;
  }
  async reassignRemainingRecuts(
    context: UnitOfWorkContext,
    sourceId: string,
    workOrderId: string,
    blinds: CreateAllocation['requirements'],
    stockIds: string[],
    actor: string,
  ) {
    if (!stockIds.length) return null;
    if (stockIds.length === 1) {
      const [available] = await this.recutStock(
        context,
        sourceId,
        blinds,
        stockIds[0]!,
      );
      return available
        ? this.reserveRecut(
            context,
            sourceId,
            workOrderId,
            blinds,
            available.id,
            actor,
          )
        : null;
    }
    // Withdrawal already locked all previously reserved items. Keep the new
    // plan on those rolls, or return the requests to staff for another choice.
    const source = await context.allocations.findById(sourceId);
    if (!source) throw new NotFoundException('Original allocation not found.');
    const configured = this.cuttingRules.apply(blinds, source.settings);
    const consumed = await this.worksheets.reportedConsumedStockIds(context);
    const stocks = await this.stockItems.findForAllocation(context, {
      stockIds,
      colorIds: [blinds[0]!.fabricColorId],
    });
    const reserved = await context.allocations.reservations(stockIds);
    const available = stocks.filter(
      (s) =>
        !consumed.has(s.id) &&
        Number(reserved.get(s.id) ?? 0) < s.remainingLengthMm,
    );
    const snapshot = buildCuttingContext(configured, available, reserved);
    let result;
    try {
      result = await findFeasiblePlan(
        this.optimizer.prepare(snapshot),
        AbortSignal.timeout(groupedRecutTimeoutMs),
      );
    } catch (error) {
      if (
        error instanceof CuttingOptimizationError &&
        (error.code === 'invalid_input' || error.code === 'cancelled')
      )
        return null;
      throw error;
    }
    return result.status === 'feasible'
      ? this.reserveManualRecut(
          context,
          sourceId,
          workOrderId,
          blinds,
          result.plan,
          actor,
        )
      : null;
  }
  async releaseUnusedRecut(
    context: UnitOfWorkContext,
    id: string,
    actor: string,
    reason: string,
    unusedWorksheet?: { id: string; expectedRevision: number },
  ) {
    const header = await this.lockAllocation(context, id);
    if (!header.isRecut)
      throw new ConflictException('Expected a replacement allocation.');
    if (header.completedAt) return;
    if (unusedWorksheet) {
      const sheet = await this.worksheets.requireRecord(
        context,
        unusedWorksheet.id,
        true,
      );
      if (sheet.allocationId !== id || sheet.abandonedAt)
        throw new ConflictException(
          'The replacement worksheet changed. Reopen the withdrawal.',
        );
      await this.stockItems.findForAllocation(context, {
        stockIds: Object.keys(sheet.baselines),
        lock: true,
      });
      await this.worksheets.abandon(
        context,
        sheet,
        unusedWorksheet.expectedRevision,
        reason,
        actor,
      );
    }
    await this.worksheets.assertPlanMutable(context, id);
    const released = await this.releaseAllocation(context, id);
    return released.before.value.items.map((item) => item.stockItemId);
  }
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
          return this.details.load(context, previous);
        }
        return this.confirmPlan(context, header, input, false, userId);
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
          return this.details.load(context, previous);
        }
        const configured = await this.configureDraft(context, data);
        await context.allocations.replacePlan(header.id, configured);
        // Drafts stay out of history, which begins at confirmation.
        return this.details.load(
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
        return this.details.load(context, header);
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
          return this.details.load(context, header);
        requireDraftRevision(header, revision);
        const saved = await this.details.formData(context, header);
        const input = createAllocationSchema.safeParse({
          workOrderId: header.workOrderId,
          // The plan's allowance is applied again on confirmation.
          requirements: saved.requirements.map(requirementInput),
          // Stored cut lengths are re-derived from the blinds.
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
        return this.confirmPlan(context, header, input.data, true, userId);
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
    return this.configure(data.requirements, data.plan, settings);
  }
  private async confirmPlan(
    context: UnitOfWorkContext,
    header: AllocationRecord,
    submitted: Pick<CreateAllocation, 'requirements' | 'plan'>,
    fromDraft: boolean,
    userId: string,
  ) {
    // The order's allocated_at mirrors this allocation's confirmed_at.
    const now = new Date();
    const { order: claimed, change: order } = await this.orders.allocate(
      context,
      header.workOrderId,
      now,
    );
    requireOrderQuantity(claimed, submitted.requirements);
    // A submitted draft keeps the rules it was planned with.
    const input = this.configure(
      submitted.requirements,
      submitted.plan,
      header.settings,
    );
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
    const result = await this.details.load(context, saved);
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
        if (header.isRecut)
          throw new ConflictException(
            'Manage replacement plans through the recut request.',
          );
        const order = await this.orders.assertPlanningAllowed(
          context,
          header.workOrderId,
        );
        await this.worksheets.assertPlanMutable(context, id);
        if (await context.allocations.hasRecutHistory(id))
          throw new ConflictException(
            'The original blind requirements are retained for recut history.',
          );
        const before = await this.details.load(context, header);
        // The order lock above prevents a production completion during
        // replanning, and a change of its quantity. Replanning may change the
        // blinds, never the order's milestones.
        requireOrderQuantity(order, input.requirements);
        const configured = this.configure(
          input.requirements,
          input.plan,
          header.settings,
        );
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
        const result = await this.details.load(context, saved);
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
        if (header.isRecut)
          throw new ConflictException(
            'Withdraw the recut to release its stock.',
          );
        if (header.cancelledAt) return this.details.load(context, header);
        requireActiveRevision(header, revision);
        await this.worksheets.assertPlanMutable(context, id);
        const order = await this.orders.release(context, header.workOrderId);
        if (
          await context.allocations.hasUnresolvedRecutWork(header.workOrderId)
        )
          throw new ConflictException(
            'Resolve recuts and reconcile their cutting results before releasing the order.',
          );
        const items = await context.allocations.items(id);
        await this.stockItems.findForAllocation(context, {
          stockIds: items.map((item) => item.stockItemId!),
          lock: true,
        });
        const before = await this.details.load(context, header);
        const result = await this.details.load(
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
      ? await this.worksheets.forAllocation(context, allocation.id)
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
              submittedAt: worksheet.submittedAt,
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
    if (await context.allocations.hasUnresolvedRecutWork(order.id))
      throw new ConflictException(
        'Resolve recuts and reconcile their cutting results before releasing the order.',
      );
    const found = allocation
      ? await this.worksheets.forAllocation(context, allocation.id)
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
      await this.details.load(context, header),
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
        value: allocationDetailSchema.parse(
          await this.details.load(context, saved),
        ),
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
      if (header.isRecut && !worksheetId)
        throw new ConflictException(
          'Submit and review the replacement worksheet.',
        );
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
        return this.details.load(context, header);
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
      const unusedIds = input.unusedStockItemIds ?? [];
      const usedIds = input.items.map((item) => item.stockItemId);
      if (
        unusedIds.some((stockId) => !ids.includes(stockId)) ||
        ids.some(
          (stockId) =>
            !usedIds.includes(stockId) && !unusedIds.includes(stockId),
        )
      )
        throw new BadRequestException(
          'Record a result or mark unused for every planned stock item.',
        );
      const additionalIds = usedIds.filter((stockId) => !ids.includes(stockId));
      // Worksheet observations must keep their captured stock baselines.
      if (worksheetId && (unusedIds.length || additionalIds.length))
        throw new BadRequestException(
          'Worksheet results must cover their captured stock items.',
        );
      // Lock both released reservations and actual usage together, in stock ID order.
      const now = new Date();
      const stocks = await this.stockItems.findForAllocation(context, {
        stockIds: [...new Set([...ids, ...usedIds])],
        lock: true,
      });
      if (!worksheetId)
        await this.worksheets.assertStockReconciliationAllowed(
          context,
          usedIds,
        );
      const before = allocationDetailSchema.parse(
        await this.details.load(context, header),
      );
      const reservations = await context.allocations.reservations(
        additionalIds,
        id,
      );
      for (const stockId of additionalIds) {
        const stock = stocks.find((item) => item.id === stockId);
        if (!stock)
          throw new NotFoundException('Additional stock item not found.');
        if (stock.consumedAt || stock.voidedAt)
          throw new ConflictException(
            'Additional fabric is consumed or voided.',
          );
        if (reservations.has(stockId))
          throw new ConflictException(
            'Additional fabric is reserved for another allocation.',
          );
        if (
          !before.requirements.some(
            (line) => line.fabricColorId === stock.fabricColorId,
          )
        )
          throw new BadRequestException(
            'Additional fabric must match a color on the order.',
          );
      }
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
          ...(unusedIds.length ? { unusedStockItemIds: unusedIds } : {}),
          createdStockItemIds: effects
            .filter((e) => !e.before)
            .map((e) => e.stockItemId),
          affectedAllocationIds: [],
        },
      });
      // Retire this order's reservations before looking for shortages in the
      // remaining orders; observed measurements are kept even if stock is short.
      const affectedAllocationIds =
        await context.allocations.affectedAllocations(usedIds);
      saved = await context.allocations.saveCompletionFlags(id, {
        ...saved.completion!,
        affectedAllocationIds,
      });
      const result = await this.details.load(context, saved);
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
    return allocationDetailSchema.parse(
      await this.details.load(context, header),
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
        return this.details.load(context, header);
      }),
    );
  }
  // Cutting rules and cut lengths are server-derived on every write, so a
  // draft, submission, or edit never carries client-authored lengths.
  /** Applies the plan's rules: each blind's allowance and each cut's length. */
  private configure<
    R extends { id: string; lengthMm: number | null },
    C extends { items: { requirementId: string }[] },
  >(
    requirements: readonly R[],
    plan: { cuts: C[] },
    saved?: Parameters<CuttingRulesService['apply']>[1],
  ) {
    const rules = this.cuttingRules.apply([...requirements], saved);
    return { ...rules, plan: planCutLengths(rules.requirements, plan) };
  }
  private async validateForWrite(
    context: UnitOfWorkContext,
    input: ConfiguredAllocationPlan,
    excludeId?: string,
    previousIds: string[] = [],
  ) {
    return this.validatePlan(context, input, {
      lock: true,
      excludeId,
      previousIds,
    });
  }
  private async validatePlan(
    context: UnitOfWorkContext,
    input: ConfiguredAllocationPlan,
    {
      lock,
      excludeId,
      previousIds = [],
    }: { lock: boolean; excludeId?: string; previousIds?: string[] },
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
      lock,
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
}
