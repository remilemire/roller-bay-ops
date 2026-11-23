import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type {
  WorksheetSubmit,
  worksheetReviewSchema,
} from '@roller-bay/shared/production';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { RecutsService } from './recuts.service.js';
import { ProductionService } from './production.service.js';
import { UnitOfWork } from '../../unit-of-work/unit-of-work.js';
import { AllocationsService } from '../allocations/index.js';
import { AuditService } from '../audit/index.js';
import {
  worksheetOperation,
  presentWorksheet,
  CuttingWorksheetsService,
} from '../cutting-worksheets/index.js';
import { StockItemsService } from '../stock-items/index.js';
import { WorkOrdersService } from '../work-orders/index.js';
@Injectable()
export class CuttingWorkflowService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly audit: AuditService,
    private readonly allocations: AllocationsService,
    private readonly orders: WorkOrdersService,
    private readonly stock: StockItemsService,
    private readonly worksheets: CuttingWorksheetsService,
    private readonly recuts: RecutsService,
    private readonly production: ProductionService,
  ) {}
  replacementSheet(orderId: string, planId: string) {
    return worksheetOperation(() =>
      this.unitOfWork.readOnlyTransaction(async (context) => {
        const sheet = await this.worksheets.forAllocation(context, planId);
        if (sheet && (!sheet.snapshot.isRecut || sheet.workOrderId !== orderId))
          throw new ConflictException(
            'Select a replacement plan for this order.',
          );
        if (
          !sheet &&
          !(await context.production.recutsForPlan(planId)).some(
            (r) => r.workOrderId === orderId && r.stage === 'cutting',
          )
        )
          throw new ConflictException(
            'This replacement plan is closed. Open the current worksheet from the cutting station.',
          );
        return sheet;
      }),
    );
  }
  begin(
    orderId: string,
    employeeIds: string[],
    actor: string,
    replacementPlanId?: string,
  ) {
    return worksheetOperation(() =>
      this.unitOfWork.transaction(async (context) => {
        // Same lock order as allocation edits: allocation -> order -> worksheet -> sorted stock.
        const allocation = replacementPlanId
          ? await this.allocations.lockAllocation(context, replacementPlanId)
          : await this.allocations.lockForCutting(context, orderId);
        if (
          replacementPlanId &&
          (!allocation.isRecut || allocation.workOrderId !== orderId)
        )
          throw new ConflictException(
            'Select a replacement plan for this order.',
          );
        const existing = await this.worksheets.forAllocation(
          context,
          allocation.id,
        );
        if (existing) return existing;
        const order = await this.orders.requireOrder(context, orderId);
        this.orders.assertNotCancelled(order);
        if (!order.allocatedAt)
          throw new ConflictException('Allocate this order before cutting.');
        if (!allocation.isRecut && (order.cutAt || order.shippedAt))
          throw new ConflictException('This order is already cut or shipped.');
        const snapshot = await this.allocations.worksheetSnapshot(
          context,
          allocation.id,
        );
        const stocks = await this.stock.findForAllocation(context, {
          stockIds: snapshot.items.map((i) => i.stockItemId),
          lock: true,
        });
        // Balances may have changed while waiting for the shared stock locks.
        const lockedSnapshot = await this.allocations.worksheetSnapshot(
          context,
          allocation.id,
        );
        return this.worksheets.start(
          context,
          lockedSnapshot,
          stocks,
          employeeIds,
          actor,
        );
      }),
    );
  }
  submit(id: string, input: WorksheetSubmit, actor: string) {
    return worksheetOperation(() =>
      this.unitOfWork.transaction(async (context) => {
        const initial = await this.worksheets.requireRecord(context, id);
        await this.allocations.lockAllocation(context, initial.allocationId);
        const order = await this.orders.requireOrder(
          context,
          initial.workOrderId,
        );
        this.orders.assertNotCancelled(order);
        if (!order.allocatedAt)
          throw new ConflictException(
            'Allocate fabric before submitting cutting results.',
          );
        const row = await this.worksheets.requireRecord(context, id, true);
        const result = await this.worksheets.submitInTransaction(
          context,
          id,
          input,
          actor,
        );
        // The sheet's employees are credited as they stand at submission. A
        // return clears submittedAt but retains results. Resubmissions and
        // retries must not overwrite attribution or restore an admin-cleared
        // milestone.
        if (row.results) return result;
        if (row.snapshot.isRecut) {
          await this.recuts.cut(context, row.allocationId, actor);
          // Only the last replacement completes a previously submitted primary sheet.
          if (!order.cutAwaitingRecuts) return result;
        }
        if (order.cutAt) return result;
        if (await context.production.hasUncutRecuts(order.id)) {
          if (!row.snapshot.isRecut)
            await this.orders.deferCutUntilRecuts(context, order.id);
        } else {
          await this.production.recordWorksheetCut(
            context,
            order,
            result.employees.map((e) => e.employeeId).sort(),
            actor,
            new Date(result.submittedAt!),
          );
        }
        return result;
      }),
    );
  }
  abandon(
    id: string,
    expectedRevision: number,
    reason: string,
    actor: string,
    canAbandonPrimary: boolean,
  ) {
    return worksheetOperation(() =>
      this.unitOfWork.transaction(async (context) => {
        const initial = await this.worksheets.requireRecord(context, id);
        if (!initial.snapshot.isRecut && !canAbandonPrimary)
          throw new ForbiddenException(
            'Only an admin or owner can cancel the original cutting worksheet.',
          );
        if (initial.abandonedAt) return presentWorksheet(initial);
        await this.allocations.lockAllocation(context, initial.allocationId);
        if (initial.snapshot.isRecut) {
          await this.orders.requireOrder(context, initial.workOrderId);
          if (initial.results)
            throw new ConflictException(
              'This replacement has already been cut.',
            );
        } else
          await this.orders.assertPlanningAllowed(context, initial.workOrderId);
        const row = await this.worksheets.requireRecord(context, id, true);
        await this.stock.findForAllocation(context, {
          stockIds: Object.keys(row.baselines),
          lock: true,
        });
        return this.worksheets.abandon(
          context,
          row,
          expectedRevision,
          reason,
          actor,
        );
      }),
    );
  }
  review(
    id: string,
    expectedRevision: number,
    actor: string,
    resolution: z.infer<typeof worksheetReviewSchema>['resolution'],
    key: string,
  ) {
    return worksheetOperation(() =>
      this.unitOfWork.transaction(async (context) => {
        const initial = await this.worksheets.requireRecord(context, id);
        await this.allocations.lockAllocation(context, initial.allocationId);
        const row = await this.worksheets.requireRecord(context, id, true);
        const scope = 'cutting.review';
        const replay = await this.audit.replay(context, actor, scope, id, key, {
          expectedRevision,
          resolution,
        });
        if (replay.result) return presentWorksheet(row);
        if (row.reviewedAt)
          throw new ConflictException(
            'This worksheet has already been reviewed. Refresh to see the accepted results.',
          );
        const ids = Object.keys(row.baselines);
        const stocks = await this.stock.findForAllocation(context, {
          stockIds: ids,
          lock: true,
        });
        const results = await this.worksheets.prepareReview(
          context,
          row,
          expectedRevision,
          stocks,
          resolution,
        );
        await this.allocations.completeInTransaction(
          context,
          row.allocationId,
          results,
          actor,
          randomUUID(),
          row.id,
        );
        const updatedStock = await this.stock.findForAllocation(context, {
          stockIds: ids,
        });
        const { worksheet, eventId } = await this.worksheets.markReviewed(
          context,
          row,
          updatedStock,
          actor,
          resolution?.reason ?? null,
        );
        await this.audit.remember(
          context,
          actor,
          scope,
          id,
          key,
          replay.requestHash,
          {
            eventId,
            recordId: id,
            revision: worksheet.revision,
            affectedAllocationIds: [],
            createdStockItemIds: [],
          },
        );
        return worksheet;
      }),
    );
  }
}
