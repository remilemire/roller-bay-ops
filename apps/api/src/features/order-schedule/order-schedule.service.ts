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
import { AuditService } from '../audit/audit.service.js';
import { orderScheduleOperation } from './order-schedule.operation.js';
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
          await repository.findById(id, 'no key update'),
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
        const previous = requireRevision(
          await repository.findById(id, 'update'),
          revision,
        );
        await this.audit.record(tx, userId, 'order.deleted', [
          change(previous, null),
        ]);
        await repository.delete(id);
      }),
    );
  }
}
