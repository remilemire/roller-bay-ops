import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuditChange } from '@roller-bay/shared/audit';
import type { Station } from '@roller-bay/shared/users';
import type {
  CreateWorkOrder,
  UpdateWorkOrder,
  WorkOrderList,
  WorkOrderQuery,
} from '@roller-bay/shared/work-orders';
import type { UnitOfWorkContext } from '../../unit-of-work/unit-of-work-context.js';
import { UnitOfWork } from '../../unit-of-work/unit-of-work.js';
import { AuditService } from '../audit/index.js';
import {
  orderAlreadyAllocated,
  orderAlreadyExists,
  orderNotFound,
  workOrdersOperation,
} from './work-orders.operation.js';
import { presentWorkOrder } from './work-orders.presenter.js';
import {
  WorkOrdersRepository,
  type WorkOrderRecord,
} from './work-orders.repository.js';
function change(
  before: WorkOrderRecord | null,
  after: WorkOrderRecord | null,
): AuditChange {
  return {
    recordType: 'work-orders',
    recordId: (after ?? before)!.id,
    before: before && {
      type: 'work-orders',
      value: presentWorkOrder(before),
    },
    after: after && {
      type: 'work-orders',
      value: presentWorkOrder(after),
    },
  };
}
function requireRevision(row: WorkOrderRecord | undefined, revision: number) {
  if (!row) throw new NotFoundException('Order not found.');
  if (row.revision !== revision)
    throw new ConflictException('Order changed; refresh before saving.');
  return row;
}
@Injectable()
export class WorkOrdersService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly audit: AuditService,
    private readonly repository: WorkOrdersRepository,
  ) {}
  list(query: WorkOrderQuery): Promise<WorkOrderList> {
    return workOrdersOperation(async () => {
      const { items, total } = await this.unitOfWork.readOnlyTransaction(
        async (context) => context.workOrders.list(query),
      );
      return {
        items: items.map(presentWorkOrder),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }
  findById(id: string) {
    return workOrdersOperation(async () => {
      const row = await this.repository.findById(id);
      if (!row) throw new NotFoundException('Order not found.');
      return presentWorkOrder(row);
    });
  }
  /**
   * Employees create the orders they allocate fabric for. A note, and bringing
   * back an order an admin deleted, stay with admins; both are refused rather
   * than quietly dropped.
   */
  create(input: CreateWorkOrder, userId: string, isAdmin: boolean) {
    if (input.note && !isAdmin)
      throw new ForbiddenException('Only an admin can add a note to an order.');
    return workOrdersOperation(() =>
      this.unitOfWork.transaction(async (context) => {
        const row = await context.workOrders.create(input);
        if (!row) throw orderAlreadyExists();
        if (row.revision > 1 && !isAdmin)
          throw new ConflictException({
            message: 'This order was deleted. An admin can restore it.',
            issues: [
              {
                code: 'order_deleted',
                path: ['orderNumber'],
                message: 'Deleted; an admin can restore it.',
              },
            ],
          });
        // A deleted order's history ends with no record, so restoring it
        // starts from none as well.
        await this.audit.record(
          context,
          userId,
          row.revision > 1 ? 'order.restored' : 'order.created',
          [change(null, row)],
        );
        return presentWorkOrder(row);
      }),
    );
  }
  update(id: string, input: UpdateWorkOrder, userId: string) {
    return workOrdersOperation(() =>
      this.unitOfWork.transaction(async (context) => {
        const previous = requireRevision(
          await context.workOrders.findByIdForUpdate(id),
          input.expectedRevision,
        );
        this.assertNotCancelled(previous);
        // Fabric is allocated before a date is promised. The database holds
        // the same rule; this answers with the field it concerns.
        if (input.shipDate && !previous.allocatedAt)
          throw new ConflictException({
            message: 'Allocate fabric for this order before scheduling it.',
            issues: [
              {
                code: 'order_not_allocated',
                path: ['shipDate'],
                message: 'Allocate fabric first.',
              },
            ],
          });
        // The allocation's blinds were checked against this quantity.
        if (
          input.quantity !== undefined &&
          input.quantity !== previous.quantity &&
          previous.allocatedAt
        )
          throw new ConflictException({
            message:
              'This order has an allocation. Cancel it before changing the quantity.',
            issues: [
              {
                code: 'order_allocated',
                path: ['quantity'],
                message: 'Fixed while the order has an allocation.',
              },
            ],
          });
        const row = await context.workOrders.update(id, {
          shipDate: input.shipDate,
          quantity: input.quantity,
          // Kept through a reschedule: it is when the order went on the
          // schedule, not when its date last moved.
          scheduledAt:
            input.shipDate === undefined
              ? undefined
              : input.shipDate === null
                ? null
                : (previous.scheduledAt ?? new Date()),
          note: input.note,
        });
        const action =
          !previous.shipDate && row.shipDate
            ? 'order.scheduled'
            : previous.shipDate && !row.shipDate
              ? 'order.unscheduled'
              : 'order.updated';
        await this.audit.record(context, userId, action, [
          change(previous, row),
        ]);
        return presentWorkOrder(row);
      }),
    );
  }
  delete(id: string, revision: number, userId: string) {
    return workOrdersOperation(() =>
      this.unitOfWork.transaction(async (context) => {
        // Holding the row's lock keeps an allocation from confirming against
        // the order between this check and the delete.
        const previous = requireRevision(
          await context.workOrders.findByIdForUpdate(id),
          revision,
        );
        this.assertNotCancelled(previous);
        if (
          previous.allocatedAt ||
          previous.shipDate ||
          previous.cutAt ||
          previous.assembledAt ||
          previous.checkedAt ||
          previous.shippedAt
        )
          throw new ConflictException(
            'Use order cancellation to retain the production history.',
          );
        await context.workOrders.delete(id);
        await this.audit.record(context, userId, 'order.deleted', [
          change(previous, null),
        ]);
      }),
    );
  }
  // The allocation workflow stamps the order inside its own transaction and
  // records the returned change on its own audit event. Only allocated_at
  // mirrors allocation state; production records its milestones separately.
  /**
   * Claims the order for a confirmed allocation and returns it as it was, so
   * the allocation can check its blinds against the order's quantity. The
   * row lock, held from here, keeps the quantity from changing before
   * confirmation.
   */
  async allocate(context: UnitOfWorkContext, workOrderId: string, at: Date) {
    const order = await context.workOrders.findByIdForUpdate(workOrderId);
    if (!order) throw orderNotFound();
    this.assertNotCancelled(order);
    if (order.allocatedAt) throw orderAlreadyAllocated();
    // The derived status would hide an allocation made after shipping.
    if (order.shippedAt)
      throw new ConflictException({
        message: 'This order has already shipped.',
        issues: [
          {
            code: 'order_shipped',
            path: ['workOrderId'],
            message: 'Already shipped.',
          },
        ],
      });
    return {
      order,
      change: change(
        order,
        await context.workOrders.stamp(order.id, { allocatedAt: at }),
      ),
    };
  }
  /**
   * The guarded allocation-cancel route releases the allocation stamp while
   * retaining the promised date. Recorded production still requires review.
   */
  release(context: UnitOfWorkContext, workOrderId: string) {
    return this.restamp(
      context,
      workOrderId,
      { allocatedAt: null },
      (order) => {
        if (
          order.cutAt ||
          order.assembledAt ||
          order.checkedAt ||
          order.shippedAt
        )
          throw new ConflictException(
            'Production has been recorded. Resolve the milestones before cancelling the allocation.',
          );
      },
    );
  }
  async requireOrder(context: UnitOfWorkContext, id: string, lock = true) {
    const order = lock
      ? await context.workOrders.findByIdForUpdate(id)
      : await context.workOrders.findById(id);
    if (!order) throw orderNotFound();
    return order;
  }
  async recordProductionMilestone(
    context: UnitOfWorkContext,
    id: string,
    station: Station,
    at: Date | null,
  ) {
    await this.requireOrder(context, id);
    return context.workOrders.setProductionMilestone(id, station, at);
  }
  /** Locks the order for a replan and returns it; refuses once production is recorded. */
  async assertPlanningAllowed(context: UnitOfWorkContext, workOrderId: string) {
    const order = await context.workOrders.findByIdForUpdate(workOrderId);
    if (!order) throw orderNotFound();
    this.assertNotCancelled(order);
    if (order.cutAt || order.assembledAt || order.checkedAt || order.shippedAt)
      throw new ConflictException(
        'Production has been recorded; the fabric plan cannot be changed.',
      );
    return order;
  }
  assertNotCancelled(order: WorkOrderRecord) {
    if (order.cancelledAt)
      throw new ConflictException('This order is cancelled.');
  }
  // Cancellation callers hold the order lock and own the related allocation changes.
  async recordAllocationRelease(
    context: UnitOfWorkContext,
    order: WorkOrderRecord,
  ) {
    this.assertCanStopWork(order);
    const row = await context.workOrders.update(order.id, {
      allocatedAt: null,
    });
    return { row, change: change(order, row) };
  }
  async cancel(
    context: UnitOfWorkContext,
    order: WorkOrderRecord,
    reason: string,
  ) {
    this.assertCanStopWork(order);
    const row = await context.workOrders.update(order.id, {
      shipDate: null,
      scheduledAt: null,
      allocatedAt: null,
      cancelledAt: new Date(),
      cancellationReason: reason,
    });
    return { row, change: change(order, row) };
  }
  private assertCanStopWork(order: WorkOrderRecord) {
    this.assertNotCancelled(order);
    if (order.shippedAt)
      throw new ConflictException(
        'Shipped orders cannot be cancelled or released.',
      );
  }
  private async restamp(
    context: UnitOfWorkContext,
    workOrderId: string,
    values: Parameters<WorkOrdersRepository['stamp']>[1],
    allow?: (order: WorkOrderRecord) => void,
  ): Promise<AuditChange> {
    const order = await context.workOrders.findByIdForUpdate(workOrderId);
    // The foreign key keeps an allocation's order in existence.
    if (!order) throw orderNotFound();
    allow?.(order);
    return change(order, await context.workOrders.stamp(order.id, values));
  }
}
