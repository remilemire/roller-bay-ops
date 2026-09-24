import { Injectable } from '@nestjs/common';
import type { OrderCancellation } from '@roller-bay/shared/work-orders';
import { UnitOfWork } from '../../unit-of-work/unit-of-work.js';
import { AuditService } from '../audit/audit.service.js';
import { WorkOrdersService } from '../work-orders/work-orders.service.js';
import { workOrdersOperation } from '../work-orders/work-orders.operation.js';
import { AllocationsService } from '../allocations/allocations.service.js';

@Injectable()
export class WorkOrderCancellationService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly orders: WorkOrdersService,
    private readonly allocations: AllocationsService,
    private readonly audit: AuditService,
  ) {}
  context(id: string) {
    return workOrdersOperation(() =>
      this.uow.readOnlyTransaction((context) =>
        this.allocations.cancellationContextForOrder(context, id),
      ),
    );
  }
  cancel(id: string, input: OrderCancellation, actor: string, key: string) {
    return workOrdersOperation(() =>
      this.uow.transaction(async (context) => {
        const { order, allocation } =
          await this.allocations.lockOrderForCancellation(context, id);
        const scope = 'order.cancel';
        const replay = await this.audit.replay(
          context,
          actor,
          scope,
          id,
          key,
          input,
        );
        if (replay.result) return replay.result;
        const { changes, skippedResults } =
          await this.allocations.cancelForOrder(
            context,
            order,
            allocation,
            input,
          );
        const result = await this.orders.cancel(context, order, input.reason);
        changes.unshift(result.change);
        const eventId = await this.audit.record(
          context,
          actor,
          skippedResults
            ? 'order.cancelled.results-skipped'
            : 'order.cancelled',
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
            revision: result.row.revision,
            affectedAllocationIds: allocation ? [allocation.id] : [],
            createdStockItemIds: [],
          },
        );
      }),
    );
  }
}
