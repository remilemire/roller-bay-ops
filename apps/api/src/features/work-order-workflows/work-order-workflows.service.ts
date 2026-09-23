import { ConflictException, Injectable } from '@nestjs/common';
import {
  orderWorkflowContextSchema,
  type OrderWorkflow,
} from '@roller-bay/shared/work-orders';
import type { AuditChange } from '@roller-bay/shared/audit';
import { UnitOfWork } from '../../unit-of-work/unit-of-work.js';
import { AuditService } from '../audit/audit.service.js';
import { WorkOrdersService } from '../work-orders/work-orders.service.js';
import { presentWorkOrder } from '../work-orders/work-orders.presenter.js';
import { workOrdersOperation } from '../work-orders/work-orders.operation.js';
import { AllocationsService } from '../allocations/allocations.service.js';
import { CuttingWorksheetsService } from '../cutting-worksheets/cutting-worksheets.service.js';

@Injectable()
export class WorkOrderWorkflowsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly orders: WorkOrdersService,
    private readonly allocations: AllocationsService,
    private readonly worksheets: CuttingWorksheetsService,
    private readonly audit: AuditService,
  ) {}

  context(id: string) {
    return workOrdersOperation(() =>
      this.uow.readOnlyTransaction(async (context) => {
        const order = await this.orders.requireOrder(context, id, false);
        const live = await context.allocations.liveForOrder(id);
        const allocation = live
          ? await context.allocations.findById(live.id)
          : null;
        const worksheet = allocation
          ? await context.cuttingWorksheets.forAllocation(allocation.id)
          : null;
        return orderWorkflowContextSchema.parse({
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
            !!(
              worksheet ||
              order.cutAt ||
              order.assembledAt ||
              order.checkedAt
            ),
        });
      }),
    );
  }

  execute(id: string, input: OrderWorkflow, actor: string, key: string) {
    return workOrdersOperation(() =>
      this.uow.transaction(async (context) => {
        // Existing cutting operations lock allocation -> order -> worksheet -> stock.
        // Re-read the live allocation after the order lock to catch confirmation
        // racing a preview that had no allocation, without inverting that order.
        const initial = await context.allocations.liveForOrder(id);
        const allocation = initial
          ? await this.allocations.lockForWorksheet(context, initial.id)
          : null;
        const order = await this.orders.requireOrder(context, id);
        const replay = await this.audit.replay(
          context,
          actor,
          'order.workflow',
          id,
          key,
          input,
        );
        if (replay.result) return replay.result;
        const live = await context.allocations.liveForOrder(id);
        if (
          (initial?.id ?? null) !== (live?.id ?? null) ||
          order.revision !== input.expectedRevision ||
          (live?.id ?? null) !== input.allocationId ||
          (allocation?.revision ?? null) !== input.expectedAllocationRevision
        )
          throw new ConflictException(
            'The order or allocation changed. Refresh the cancellation form.',
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
        if (input.action === 'unschedule' && !order.shipDate)
          throw new ConflictException('This order has no schedule date.');
        if (input.action === 'release-allocation' && !allocation)
          throw new ConflictException(
            'This order has no allocation to release.',
          );
        const outstanding =
          !!allocation &&
          !allocation.completedAt &&
          !!(sheet || order.cutAt || order.assembledAt || order.checkedAt);
        if (
          input.action !== 'unschedule' &&
          outstanding &&
          !input.skipCuttingResults
        )
          throw new ConflictException(
            'Resolve outstanding cutting results or explicitly continue without recording them.',
          );
        const changes: AuditChange[] = [];
        if (input.action !== 'unschedule') {
          if (sheet)
            changes.push(await this.worksheets.skipResults(context, sheet));
          if (allocation)
            changes.push(
              await this.allocations.releaseForOrder(context, allocation.id),
            );
        }
        const result = await this.orders.applyWorkflow(
          context,
          order,
          input.action,
          input.reason,
        );
        changes.unshift(result.change);
        const action =
          input.action === 'cancel-order'
            ? 'order.cancelled'
            : input.action === 'release-allocation'
              ? 'order.allocation-released'
              : 'order.unscheduled';
        // The action explicitly preserves the acknowledged stock-accounting gap,
        // including paper cutting with no worksheet to carry a skipped timestamp.
        const eventId = await this.audit.record(
          context,
          actor,
          outstanding && input.action !== 'unschedule'
            ? `${action}.results-skipped`
            : action,
          changes,
          input.reason,
        );
        return this.audit.remember(
          context,
          actor,
          'order.workflow',
          id,
          key,
          replay.requestHash,
          {
            eventId,
            recordId: id,
            revision: result.row.revision,
            affectedAllocationIds:
              allocation && input.action !== 'unschedule'
                ? [allocation.id]
                : [],
            createdStockItemIds: [],
          },
        );
      }),
    );
  }
}
