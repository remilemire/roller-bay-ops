import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuditChange } from '@roller-bay/shared/audit';
import type {
  CreateWorkOrder,
  WorkOrderList,
  WorkOrderQuery,
  UpdateWorkOrder,
} from '@roller-bay/shared/work-orders';
import type { DatabaseTransaction } from '../../database/database.service.js';
import { AuditService } from '../audit/audit.service.js';
import {
  orderAlreadyAllocated,
  orderAlreadyScheduled,
  orderNotScheduled,
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

function requireQuantity(order: WorkOrderRecord, quantity: number) {
  if (order.quantity !== quantity)
    throw new BadRequestException({
      message: `The order has ${order.quantity} blinds but the allocation has ${quantity}.`,
      issues: [
        {
          code: 'order_quantity_mismatch',
          path: ['orderNumber'],
          message: `The order has ${order.quantity} blinds; ${quantity} entered.`,
        },
      ],
    });
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
    private readonly audit: AuditService,
    private readonly repository: WorkOrdersRepository,
  ) {}

  list(query: WorkOrderQuery): Promise<WorkOrderList> {
    return workOrdersOperation(async () => {
      const { items, total } = await this.repository.list(query);
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

  create(input: CreateWorkOrder, userId: string) {
    return workOrdersOperation(() =>
      this.repository.withTransaction(async (repository, tx) => {
        const row = await repository.create(input);
        if (!row) throw orderAlreadyScheduled();
        // A deleted order's history ends with no record, so restoring it
        // starts from none as well.
        await this.audit.record(
          tx,
          userId,
          row.revision > 1 ? 'order.restored' : 'order.scheduled',
          [change(null, row)],
        );
        return presentWorkOrder(row);
      }),
    );
  }

  update(id: string, input: UpdateWorkOrder, userId: string) {
    return workOrdersOperation(() =>
      this.repository.withTransaction(async (repository, tx) => {
        const previous = requireRevision(
          await repository.findByIdForUpdate(id),
          input.expectedRevision,
        );
        // The allocation's blinds were checked against this quantity.
        if (
          previous.allocatedAt &&
          input.quantity !== undefined &&
          input.quantity !== previous.quantity
        )
          throw new ConflictException({
            message:
              'This order has an allocation. Cancel or replace it before changing the quantity.',
            issues: [
              {
                code: 'order_allocated',
                path: ['quantity'],
                message: 'Fixed while the order has an allocation.',
              },
            ],
          });
        const { shipped } = input;
        const row = await repository.update(id, {
          shipDate: input.shipDate,
          quantity: input.quantity,
          note: input.note,
          // Marking a shipped order shipped again keeps its original time.
          shippedAt:
            shipped === undefined
              ? undefined
              : shipped
                ? (previous.shippedAt ?? new Date())
                : null,
        });
        const action =
          shipped === undefined || shipped === !!previous.shippedAt
            ? 'order.updated'
            : shipped
              ? 'order.shipped'
              : 'order.unshipped';
        await this.audit.record(tx, userId, action, [change(previous, row)]);
        return presentWorkOrder(row);
      }),
    );
  }

  delete(id: string, revision: number, userId: string) {
    return workOrdersOperation(() =>
      this.repository.withTransaction(async (repository, tx) => {
        // Holding the row's lock keeps an allocation from confirming against
        // the order between this check and the delete.
        const previous = requireRevision(
          await repository.findByIdForUpdate(id),
          revision,
        );
        if (previous.allocatedAt)
          throw new ConflictException(
            'This order has an allocation. Cancel it before deleting the order.',
          );
        await repository.delete(id);
        await this.audit.record(tx, userId, 'order.deleted', [
          change(previous, null),
        ]);
      }),
    );
  }

  // The allocation workflow stamps the order inside its own transaction and
  // records the returned change on its own audit event. allocated_at and
  // cut_at mirror the live allocation's confirmed_at and completed_at.

  /** A draft may only name an order that is on the schedule. */
  async requireScheduled(tx: DatabaseTransaction, orderNumber: string) {
    const repository = new WorkOrdersRepository({ db: tx });
    if (!(await repository.findByOrderNumber(orderNumber)))
      throw orderNotScheduled();
  }

  /** `quantity` is the total of the allocation's blinds. */
  async allocate(
    tx: DatabaseTransaction,
    orderNumber: string,
    quantity: number,
    at: Date,
  ): Promise<AuditChange> {
    const repository = new WorkOrdersRepository({ db: tx });
    const order = await repository.findByOrderNumberForUpdate(orderNumber);
    if (!order) throw orderNotScheduled();
    if (order.allocatedAt) throw orderAlreadyAllocated();
    // The derived status would hide an allocation made after shipping.
    if (order.shippedAt)
      throw new ConflictException({
        message: 'This order has already shipped.',
        issues: [
          {
            code: 'order_shipped',
            path: ['orderNumber'],
            message: 'Already shipped.',
          },
        ],
      });
    requireQuantity(order, quantity);
    return change(order, await repository.stamp(order.id, { allocatedAt: at }));
  }

  /** A replanned allocation must still add up to its order. */
  async verifyQuantity(
    tx: DatabaseTransaction,
    orderNumber: string,
    quantity: number,
  ) {
    const repository = new WorkOrdersRepository({ db: tx });
    const order = await repository.findByOrderNumberForUpdate(orderNumber);
    if (!order) throw orderNotScheduled();
    requireQuantity(order, quantity);
  }

  /** The order's allocation was cancelled or moved to another order. */
  release(tx: DatabaseTransaction, orderNumber: string) {
    return this.restamp(tx, orderNumber, { allocatedAt: null });
  }

  markCut(tx: DatabaseTransaction, orderNumber: string, at: Date) {
    return this.restamp(tx, orderNumber, { cutAt: at });
  }

  private async restamp(
    tx: DatabaseTransaction,
    orderNumber: string,
    values: Parameters<WorkOrdersRepository['stamp']>[1],
  ): Promise<AuditChange> {
    const repository = new WorkOrdersRepository({ db: tx });
    const order = await repository.findByOrderNumberForUpdate(orderNumber);
    // The foreign key keeps an allocation's order on the schedule.
    if (!order) throw orderNotScheduled();
    return change(order, await repository.stamp(order.id, values));
  }
}
