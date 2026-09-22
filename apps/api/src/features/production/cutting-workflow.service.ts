import { AuditService } from '../audit/audit.service.js';
import { ConflictException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { worksheetReviewSchema } from '@roller-bay/shared/production';
import { DatabaseService } from '../../database/database.service.js';
import { AllocationsService } from '../allocations/allocations.service.js';
import { WorkOrdersService } from '../work-orders/work-orders.service.js';
import { StockItemsService } from '../stock-items/stock-items.service.js';
import { CuttingWorksheetsService } from '../cutting-worksheets/cutting-worksheets.service.js';
import { presentWorksheet } from '../cutting-worksheets/cutting-worksheets.presenter.js';
import { worksheetOperation } from '../cutting-worksheets/cutting-worksheets.operation.js';
@Injectable()
export class CuttingWorkflowService {
  constructor(
    private readonly audit: AuditService,
    private readonly database: DatabaseService,
    private readonly allocations: AllocationsService,
    private readonly orders: WorkOrdersService,
    private readonly stock: StockItemsService,
    private readonly worksheets: CuttingWorksheetsService,
  ) {}
  begin(orderId: string, employeeId: string, actor: string) {
    return worksheetOperation(() =>
      this.database.transaction(async (tx) => {
        // Same lock order as allocation edits: allocation -> order -> worksheet -> sorted stock.
        const allocation = await this.allocations.lockForCutting(tx, orderId);
        const existing = await this.worksheets.forAllocation(tx, allocation.id);
        if (existing) return existing;
        const order = await this.orders.getForProduction(tx, orderId);
        if (!order.allocatedAt)
          throw new ConflictException('Allocate this order before cutting.');
        if (order.cutAt || order.shippedAt)
          throw new ConflictException('This order is already cut or shipped.');
        const snapshot = await this.allocations.worksheetSnapshot(
          tx,
          allocation.id,
        );
        const stocks = await this.stock.findForAllocation(tx, {
          stockIds: snapshot.items.map((i) => i.stockItemId),
          lock: true,
        });
        // Balances may have changed while waiting for the shared stock locks.
        const lockedSnapshot = await this.allocations.worksheetSnapshot(
          tx,
          allocation.id,
        );
        return this.worksheets.start(
          tx,
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
      this.database.transaction(async (tx) => {
        const initial = await this.worksheets.requireRecord(tx, id);
        if (initial.abandonedAt) return presentWorksheet(initial);
        await this.allocations.lockForWorksheet(tx, initial.allocationId);
        await this.orders.assertPlanningAllowed(tx, initial.workOrderId);
        const row = await this.worksheets.requireRecord(tx, id, true);
        await this.stock.findForAllocation(tx, {
          stockIds: Object.keys(row.baselines),
          lock: true,
        });
        return this.worksheets.abandon(
          tx,
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
      this.database.transaction(async (tx) => {
        const initial = await this.worksheets.requireRecord(tx, id);
        await this.allocations.lockForWorksheet(tx, initial.allocationId);
        const row = await this.worksheets.requireRecord(tx, id, true);
        const scope = 'cutting.review';
        const replay = await this.audit.replay(tx, actor, scope, id, key, {
          expectedRevision,
          resolution,
        });
        if (replay.result) return presentWorksheet(row);
        if (row.reviewedAt)
          throw new ConflictException(
            'This worksheet has already been reviewed. Refresh to see the accepted results.',
          );
        const ids = Object.keys(row.baselines);
        const stocks = await this.stock.findForAllocation(tx, {
          stockIds: ids,
          lock: true,
        });
        const results = await this.worksheets.prepareReview(
          tx,
          row,
          expectedRevision,
          stocks,
          resolution,
        );
        await this.allocations.complete(
          row.allocationId,
          results,
          actor,
          randomUUID(),
          tx,
          row.id,
        );
        const updatedStock = await this.stock.findForAllocation(tx, {
          stockIds: ids,
        });
        const { worksheet, eventId } = await this.worksheets.markReviewed(
          tx,
          row,
          updatedStock,
          actor,
          resolution?.reason ?? null,
        );
        await this.audit.remember(
          tx,
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
