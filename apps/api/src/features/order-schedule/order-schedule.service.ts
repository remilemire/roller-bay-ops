import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuditChange } from '@roller-bay/shared/audit';
import {
  scheduledOrderSchema,
  type CreateScheduledOrder,
  type ScheduledOrder,
  type ScheduledOrderList,
  type ScheduledOrderQuery,
  type UpdateScheduledOrder,
} from '@roller-bay/shared/order-schedule';
import type { DatabaseTransaction } from '../../database/database.service.js';
import { AuditService } from '../audit/audit.service.js';
import {
  orderAlreadyAllocated,
  orderNotScheduled,
  orderScheduleOperation,
} from './order-schedule.operation.js';
import {
  OrderScheduleRepository,
  type ScheduledOrderRecord,
} from './order-schedule.repository.js';

export function toPublic(row: ScheduledOrderRecord): ScheduledOrder {
  return scheduledOrderSchema.parse({
    ...row,
    status: row.shippedAt
      ? 'shipped'
      : row.cutAt
        ? 'cut'
        : row.allocatedAt
          ? 'allocated'
          : 'scheduled',
    scheduledAt: row.scheduledAt.toISOString(),
    allocatedAt: row.allocatedAt?.toISOString() ?? null,
    cutAt: row.cutAt?.toISOString() ?? null,
    shippedAt: row.shippedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  });
}

function change(
  before: ScheduledOrderRecord | null,
  after: ScheduledOrderRecord | null,
): AuditChange {
  return {
    recordType: 'order-schedule',
    recordId: (after ?? before)!.id,
    before: before && { type: 'order-schedule', value: toPublic(before) },
    after: after && { type: 'order-schedule', value: toPublic(after) },
  };
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
        items: items.map(toPublic),
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
      return toPublic(row);
    });
  }

  create(input: CreateScheduledOrder, userId: string) {
    return orderScheduleOperation(() =>
      this.repository.withTransaction(async (repository, tx) => {
        const row = await repository.create(input);
        await this.audit.record(tx, userId, 'order.scheduled', [
          change(null, row),
        ]);
        return toPublic(row);
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
        const { shipped } = input;
        const row = await repository.update(id, {
          shipDate: input.shipDate,
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
        return toPublic(row);
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

  async allocate(
    tx: DatabaseTransaction,
    orderNumber: string,
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
    return change(order, await repository.stamp(order.id, { allocatedAt: at }));
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
