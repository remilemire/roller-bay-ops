import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuditChange } from '@roller-bay/shared/audit';
import type {
  CreateWorkOrder,
  SaveWorkOrderLines,
  WorkOrderList,
  WorkOrderQuery,
  UpdateWorkOrder,
} from '@roller-bay/shared/work-orders';
import type { DatabaseTransaction } from '../../database/database.service.js';
import { AuditService } from '../audit/audit.service.js';
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
      this.repository.withTransaction(async (repository, tx) => {
        const previous = requireRevision(
          await repository.findByIdForUpdate(id),
          input.expectedRevision,
        );
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
        const stored = await repository.lines(id, true);
        const before = stored.filter((line) => !line.retiredAt);
        const known = new Map(stored.map((line) => [line.id, line]));
        const added: Parameters<typeof repository.insertLines>[1] = [];
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
            await repository.moveLine(saved.id, position);
        }
        const kept = new Set(input.lines.map((line) => line.id));
        await repository.retireLines(
          before.filter((line) => !kept.has(line.id)).map((line) => line.id),
        );
        await repository.insertLines(id, added);
        const row = await repository.update(id, {});
        const after = await repository.lines(id);
        await this.audit.record(tx, userId, 'order.lines-saved', [
          linesChange(previous, before, row, after),
        ]);
        return presentWorkOrderDetail(row, after);
      }),
    );
  }

  create(input: CreateWorkOrder, userId: string) {
    return workOrdersOperation(() =>
      this.repository.withTransaction(async (repository, tx) => {
        const row = await repository.create(input);
        if (!row) throw orderAlreadyExists();
        // A deleted order's history ends with no record, so restoring it
        // starts from none as well.
        await this.audit.record(
          tx,
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
        const { shipped } = input;
        const row = await repository.update(id, {
          shipDate: input.shipDate,
          // Kept through a reschedule: it is when the order went on the
          // schedule, not when its date last moved.
          scheduledAt:
            input.shipDate === undefined
              ? undefined
              : input.shipDate === null
                ? null
                : (previous.scheduledAt ?? new Date()),
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
          shipped !== undefined && shipped !== !!previous.shippedAt
            ? shipped
              ? 'order.shipped'
              : 'order.unshipped'
            : !previous.shipDate && row.shipDate
              ? 'order.scheduled'
              : previous.shipDate && !row.shipDate
                ? 'order.unscheduled'
                : 'order.updated';
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

  /** A draft may only name an order that exists. */
  async requireOrder(tx: DatabaseTransaction, orderNumber: string) {
    const repository = new WorkOrdersRepository({ db: tx });
    if (!(await repository.findByOrderNumber(orderNumber)))
      throw orderNotFound();
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
    if (!order) throw orderNotFound();
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
    if (!order) throw orderNotFound();
    requireQuantity(order, quantity);
  }

  /**
   * The order's allocation was cancelled or moved to another order. Refused
   * while the order has a ship date: a date needs an allocation, and clearing
   * it here would change the schedule from a request that never named it.
   */
  release(tx: DatabaseTransaction, orderNumber: string) {
    return this.restamp(tx, orderNumber, { allocatedAt: null }, (order) => {
      if (order.shipDate)
        throw new ConflictException({
          message:
            'This order has a ship date. Clear it before cancelling its allocation.',
          issues: [
            {
              code: 'order_scheduled',
              path: ['orderNumber'],
              message: 'Has a ship date.',
            },
          ],
        });
    });
  }

  markCut(tx: DatabaseTransaction, orderNumber: string, at: Date) {
    return this.restamp(tx, orderNumber, { cutAt: at });
  }

  private async restamp(
    tx: DatabaseTransaction,
    orderNumber: string,
    values: Parameters<WorkOrdersRepository['stamp']>[1],
    allow?: (order: WorkOrderRecord) => void,
  ): Promise<AuditChange> {
    const repository = new WorkOrdersRepository({ db: tx });
    const order = await repository.findByOrderNumberForUpdate(orderNumber);
    // The foreign key keeps an allocation's order in existence.
    if (!order) throw orderNotFound();
    allow?.(order);
    return change(order, await repository.stamp(order.id, values));
  }
}
