import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuditChange } from '@roller-bay/shared/audit';
import type { Station } from '@roller-bay/shared/users';
import type {
  CreateWorkOrder,
  SaveWorkOrderLines,
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
import {
  presentWorkOrder,
  presentWorkOrderDetail,
} from './work-orders.presenter.js';
import {
  WorkOrdersRepository,
  type WorkOrderLineRecord,
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
/** A change to the blinds records them on both sides of the order's change. */
function linesChange(
  before: WorkOrderRecord,
  beforeLines: WorkOrderLineRecord[],
  after: WorkOrderRecord,
  afterLines: WorkOrderLineRecord[],
): AuditChange {
  return {
    recordType: 'work-orders',
    recordId: after.id,
    before: {
      type: 'work-orders',
      value: presentWorkOrderDetail(before, beforeLines),
    },
    after: {
      type: 'work-orders',
      value: presentWorkOrderDetail(after, afterLines),
    },
  };
}
const lineIssue = (code: string, index: number, message: string) =>
  new BadRequestException({
    message: 'A saved blind cannot be changed; replace it with a new one.',
    issues: [{ code, path: ['lines', index], message }],
  });
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
      return presentWorkOrderDetail(row, await this.repository.lines(id));
    });
  }
  /**
   * Replaces the order's list of blinds. Rows are never changed or deleted,
   * because a plan's cuts point at the blinds they were made for: a blind the
   * list keeps must be as it was saved, one it drops is retired, and a
   * changed blind arrives under a new id. Nothing outside the order is
   * touched, so plans for a retired blind fail their own validation.
   */
  saveLines(id: string, input: SaveWorkOrderLines, userId: string) {
    return workOrdersOperation(() =>
      this.unitOfWork.transaction(async (context) => {
        const previous = requireRevision(
          await context.workOrders.findByIdForUpdate(id),
          input.expectedRevision,
        );
        this.assertNotCancelled(previous);
        // The allocation's cuts were planned for these blinds.
        if (previous.allocatedAt)
          throw new ConflictException({
            message:
              'This order has an allocation. Cancel it before changing the blinds.',
            issues: [
              {
                code: 'order_allocated',
                path: ['lines'],
                message: 'Fixed while the order has an allocation.',
              },
            ],
          });
        const stored = await context.workOrders.lines(id, true);
        const before = stored.filter((line) => !line.retiredAt);
        const known = new Map(stored.map((line) => [line.id, line]));
        const added: Parameters<typeof context.workOrders.insertLines>[1] = [];
        for (const [index, line] of input.lines.entries()) {
          const position = index + 1;
          const saved = known.get(line.id);
          if (!saved) added.push({ ...line, position });
          else if (saved.retiredAt)
            throw lineIssue('line_retired', index, 'Removed earlier.');
          else if (
            saved.fabricColorId !== line.fabricColorId ||
            Number(saved.widthMm) !== line.widthMm ||
            Number(saved.lengthMm) !== line.lengthMm ||
            saved.quantity !== line.quantity
          )
            throw lineIssue('line_immutable', index, 'Already saved.');
          else if (saved.position !== position)
            await context.workOrders.moveLine(saved.id, position);
        }
        const kept = new Set(input.lines.map((line) => line.id));
        await context.workOrders.retireLines(
          before.filter((line) => !kept.has(line.id)).map((line) => line.id),
        );
        await context.workOrders.insertLines(id, added);
        const row = await context.workOrders.update(id, {});
        const after = await context.workOrders.lines(id);
        await this.audit.record(context, userId, 'order.lines-saved', [
          linesChange(previous, before, row, after),
        ]);
        return presentWorkOrderDetail(row, after);
      }),
    );
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
  /** The blinds a plan may assign; refuses an order that does not exist. */
  async lines(context: UnitOfWorkContext, workOrderId: string) {
    const order = await context.workOrders.findById(workOrderId);
    if (!order) throw orderNotFound();
    return {
      order,
      lines: await context.workOrders.lines(workOrderId, false),
    };
  }
  /** Blinds by id, retired or not: what a past plan's cuts were made for. */
  linesById(context: UnitOfWorkContext, ids: string[]) {
    return context.workOrders.linesById(ids);
  }
  /**
   * Claims the order for a confirmed allocation and returns the blinds it
   * must plan. Holding the order's row lock from here keeps a save of the
   * blinds, which takes the same lock, from slipping in before confirmation.
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
    const lines = await context.workOrders.lines(workOrderId, false);
    if (!lines.length)
      throw new BadRequestException({
        message: 'This order has no blinds. Enter them before allocating.',
        issues: [
          {
            code: 'order_has_no_lines',
            path: ['workOrderId'],
            message: 'No blinds entered.',
          },
        ],
      });
    const total = lines.reduce((sum, line) => sum + line.quantity, 0);
    if (total !== order.quantity)
      throw new BadRequestException({
        message: `The blinds add up to ${total}, but the order has ${order.quantity}.`,
        issues: [
          {
            code: 'order_quantity_mismatch',
            path: ['workOrderId'],
            message: `Blinds add up to ${total} of ${order.quantity}.`,
          },
        ],
      });
    return {
      lines,
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
  async assertPlanningAllowed(context: UnitOfWorkContext, workOrderId: string) {
    const order = await context.workOrders.findByIdForUpdate(workOrderId);
    if (!order) throw orderNotFound();
    this.assertNotCancelled(order);
    if (order.cutAt || order.assembledAt || order.checkedAt || order.shippedAt)
      throw new ConflictException(
        'Production has been recorded; the fabric plan cannot be changed.',
      );
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
