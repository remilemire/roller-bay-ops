import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuditChange } from '@roller-bay/shared/audit';
import type {
  CreateScheduledOrder,
  ScheduledOrderList,
  ScheduledOrderQuery,
  UpdateScheduledOrder,
} from '@roller-bay/shared/order-schedule';
import type { DatabaseTransaction } from '../../database/database.service.js';
import { AuditService } from '../audit/audit.service.js';
import {
  orderAlreadyAllocated,
  orderNotScheduled,
  orderScheduleOperation,
} from './order-schedule.operation.js';
import { presentScheduledOrder } from './order-schedule.presenter.js';
import {
  OrderScheduleRepository,
  type ScheduledOrderRecord,
} from './order-schedule.repository.js';

function change(
  before: ScheduledOrderRecord | null,
  after: ScheduledOrderRecord | null,
): AuditChange {
  return {
    recordType: 'order-schedule',
    recordId: (after ?? before)!.id,
    before: before && {
      type: 'order-schedule',
      value: presentScheduledOrder(before),
    },
    after: after && {
      type: 'order-schedule',
      value: presentScheduledOrder(after),
    },
  };
}

function requireQuantity(order: ScheduledOrderRecord, quantity: number) {
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

function requireRevision(
  row: ScheduledOrderRecord | undefined,
  revision: number,
) {
  if (!row) throw new NotFoundException('Order not found.');
  if (row.revision !== revision)
    throw new ConflictException('Order changed; refresh before saving.');
  return row;
}

@Injectable()
export class OrderScheduleService {
  constructor(
    private readonly audit: AuditService,
    private readonly repository: OrderScheduleRepository,
  ) {}

  list(query: ScheduledOrderQuery): Promise<ScheduledOrderList> {
    return orderScheduleOperation(async () => {
      const { items, total } = await this.repository.list(query);
      return {
        items: items.map(presentScheduledOrder),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  findById(id: string) {
    return orderScheduleOperation(async () => {
      const row = await this.repository.findById(id);
      if (!row) throw new NotFoundException('Order not found.');
      return presentScheduledOrder(row);
    });
  }

  create(input: CreateScheduledOrder, userId: string) {
    return orderScheduleOperation(() =>
      this.repository.withTransaction(async (repository, tx) => {
        const row = await repository.create(input);
        await this.audit.record(tx, userId, 'order.scheduled', [
          change(null, row),
        ]);
        return presentScheduledOrder(row);
      }),
    );
  }

  update(id: string, input: UpdateScheduledOrder, userId: string) {
    return orderScheduleOperation(() =>
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
        return presentScheduledOrder(row);
      }),
    );
  }

  delete(id: string, revision: number, userId: string) {
    return orderScheduleOperation(() =>
      this.repository.withTransaction(async (repository, tx) => {
        const previous = await repository.delete(id, revision);
        if (!previous) {
          if (await repository.findById(id))
            throw new ConflictException(
              'Order changed; refresh before saving.',
            );
          throw new NotFoundException('Order not found.');
        }
        await this.audit.record(tx, userId, 'order.deleted', [
          change(previous, null),
        ]);
      }),
    );
  }

  // The allocation workflow stamps the order inside its own transaction and
  // records the returned change on its own audit event. allocated_at and
  // cut_at mirror the live allocation's confirmed_at and completed_at.

  /** `quantity` is the total of the allocation's blinds. */
  async allocate(
    tx: DatabaseTransaction,
    orderNumber: string,
    quantity: number,
    at: Date,
  ): Promise<AuditChange> {
    const repository = new OrderScheduleRepository({ db: tx });
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
    const repository = new OrderScheduleRepository({ db: tx });
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
    values: Parameters<OrderScheduleRepository['stamp']>[1],
  ): Promise<AuditChange> {
    const repository = new OrderScheduleRepository({ db: tx });
    const order = await repository.findByOrderNumberForUpdate(orderNumber);
    // The foreign key keeps an allocation's order on the schedule.
    if (!order) throw orderNotScheduled();
    return change(order, await repository.stamp(order.id, values));
  }
}
