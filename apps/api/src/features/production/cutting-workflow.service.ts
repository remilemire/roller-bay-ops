import { ConflictException, Injectable } from '@nestjs/common';
import type { worksheetReviewSchema } from '@roller-bay/shared/production';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { UnitOfWork } from '../../unit-of-work/unit-of-work.js';
import { AllocationsService } from '../allocations/allocations.service.js';
import { AuditService } from '../audit/audit.service.js';
import { worksheetOperation } from '../cutting-worksheets/cutting-worksheets.operation.js';
import { presentWorksheet } from '../cutting-worksheets/cutting-worksheets.presenter.js';
import { CuttingWorksheetsService } from '../cutting-worksheets/cutting-worksheets.service.js';
import { StockItemsService } from '../stock-items/stock-items.service.js';
import { WorkOrdersService } from '../work-orders/work-orders.service.js';
@Injectable()
export class CuttingWorkflowService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly audit: AuditService,
    private readonly allocations: AllocationsService,
    private readonly orders: WorkOrdersService,
    private readonly stock: StockItemsService,
    private readonly worksheets: CuttingWorksheetsService,
  ) {}
  begin(orderId: string, employeeId: string, actor: string) {
    return worksheetOperation(() =>
      this.unitOfWork.transaction(async (context) => {
        // Same lock order as allocation edits: allocation -> order -> worksheet -> sorted stock.
        const allocation = await this.allocations.lockForCutting(
          context,
          orderId,
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
        if (order.cutAt || order.shippedAt)
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
          employeeId,
          actor,
        );
      }),
    );
  }
  abandon(id: string, expectedRevision: number, reason: string, actor: string) {
    return worksheetOperation(() =>
      this.unitOfWork.transaction(async (context) => {
        const initial = await this.worksheets.requireRecord(context, id);
        if (initial.abandonedAt) return presentWorksheet(initial);
        await this.allocations.lockAllocation(context, initial.allocationId);
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
