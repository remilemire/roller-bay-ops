import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  recutSchema,
  recutBlindsSchema,
  type Recut,
} from '@roller-bay/shared/production';
import type { AuditChange } from '@roller-bay/shared/audit';
import { UnitOfWork } from '../../unit-of-work/unit-of-work.js';
import type { UnitOfWorkContext } from '../../unit-of-work/unit-of-work-context.js';
import { AllocationsService } from '../allocations/index.js';
import { AuditService } from '../audit/index.js';
import {
  WorkOrdersService,
  type WorkOrderRecord,
} from '../work-orders/index.js';
import { EmployeesService } from '../employees/index.js';
import { productionOperation } from './production.operation.js';
import type { ProductionRepository } from './production.repository.js';

type Row = Awaited<ReturnType<ProductionRepository['recutsForOrder']>>[number];
type RequestInput = Pick<Recut, 'quantity' | 'reason' | 'requirementId'>;
type Change = {
  row: Row;
  before: Row | null;
  reason?: string;
  employees?: {
    employeeId: string;
    employeeName: string;
    employeeInitials: string;
  }[];
};
type WriteTarget =
  | {
      kind: 'order';
      id: string;
      apply: (
        context: UnitOfWorkContext,
        order: WorkOrderRecord,
      ) => Promise<Change>;
    }
  | {
      kind: 'recut';
      id: string;
      expectedRevision: number;
      apply: (context: UnitOfWorkContext, recut: Row) => Promise<Change>;
    };
const changeSnapshot = ({ row, before, employees }: Change): AuditChange => ({
  recordType: 'recuts',
  recordId: row.id,
  before: before ? { type: 'recuts', value: recutSchema.parse(before) } : null,
  after: { type: 'recuts', value: { ...recutSchema.parse(row), employees } },
});
@Injectable()
export class RecutsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly orders: WorkOrdersService,
    private readonly allocations: AllocationsService,
    private readonly audit: AuditService,
    private readonly employees: EmployeesService,
  ) {}
  list(orderId: string) {
    return productionOperation(() =>
      this.uow.readOnlyTransaction(async (ctx) =>
        (await ctx.production.recutsForOrder(orderId)).map((row) =>
          recutSchema.parse(row),
        ),
      ),
    );
  }
  blinds(orderId: string) {
    return productionOperation(() =>
      this.uow.readOnlyTransaction(async (ctx) =>
        recutBlindsSchema.parse(await ctx.production.recutBlinds(orderId)),
      ),
    );
  }
  private async find(ctx: UnitOfWorkContext, id: string) {
    const row = await ctx.production.findRecut(id);
    if (!row) throw new NotFoundException('Recut not found.');
    return row;
  }
  candidates(id: string) {
    return productionOperation(() =>
      this.uow.readOnlyTransaction(async (ctx) => {
        const row = await this.find(ctx, id);
        return this.allocations.recutStock(ctx, row.sourceId, row);
      }),
    );
  }
  request(orderId: string, input: RequestInput, actor: string, key: string) {
    return this.write('requested', input, actor, key, {
      kind: 'order',
      id: orderId,
      apply: async (ctx, order) => {
        if (!order.cutAt)
          throw new ConflictException(
            'Record cutting before requesting a recut.',
          );
        const blind = (await ctx.production.recutBlinds(order.id)).find(
          (b) => b.id === input.requirementId,
        );
        if (!blind?.quantity)
          throw new BadRequestException(
            'Choose a blind from the current order allocation.',
          );
        const open = await ctx.production.openRecuts(order.id);
        const pending = open
          .filter((r) => r.requirementId === blind.id)
          .reduce((sum, r) => sum + r.quantity, 0);
        if (input.quantity + pending > blind.quantity)
          throw new BadRequestException(
            'Outstanding replacements exceed the quantity of this blind.',
          );
        return {
          row: await ctx.production.createRecut({
            ...input,
            needsAssembly: true,
            workOrderId: order.id,
          }),
          before: null,
          reason: input.reason,
        };
      },
    });
  }
  assign(
    id: string,
    input: { expectedRevision: number; stockItemId: string },
    actor: string,
    key: string,
  ) {
    return this.write('assigned', input, actor, key, {
      kind: 'recut',
      id,
      expectedRevision: input.expectedRevision,
      apply: async (ctx, before) => {
        if (before.stage !== 'requested')
          throw new ConflictException(
            'This recut already has a plan or is closed.',
          );
        const allocationId = await this.allocations.reserveRecut(
          ctx,
          before.sourceId,
          before.workOrderId,
          {
            fabricColorId: before.fabricColorId,
            widthMm: before.widthMm,
            lengthMm: before.lengthMm,
            quantity: before.quantity,
          },
          input.stockItemId,
          actor,
        );
        return {
          before,
          row: await ctx.production.updateRecut(id, {
            stage: 'cutting',
            allocationId,
          }),
        };
      },
    });
  }
  withdraw(
    id: string,
    input: { expectedRevision: number; reason: string },
    actor: string,
    key: string,
  ) {
    return this.write('withdrawn', input, actor, key, {
      kind: 'recut',
      id,
      expectedRevision: input.expectedRevision,
      apply: async (ctx, before) => {
        if (before.stage === 'accepted' || before.stage === 'withdrawn')
          throw new ConflictException('This recut is closed.');
        if (before.allocationId)
          await this.allocations.releaseUnusedRecut(ctx, before.allocationId);
        return {
          before,
          row: await ctx.production.updateRecut(id, { stage: 'withdrawn' }),
          reason: input.reason,
        };
      },
    });
  }
  signoff(
    station: 'checking' | 'assembly',
    id: string,
    input: { expectedRevision: number; employeeIds: string[] },
    actor: string,
    key: string,
  ) {
    return this.write(
      station === 'assembly' ? 'assembled' : 'accepted',
      input,
      actor,
      key,
      {
        kind: 'recut',
        id,
        expectedRevision: input.expectedRevision,
        apply: async (ctx, before) => {
          if (before.stage !== station)
            throw new ConflictException(
              'This recut is not ready for this station.',
            );
          const people = await this.employees.requireActiveMany(
            ctx,
            input.employeeIds,
          );
          return {
            before,
            row: await ctx.production.updateRecut(id, {
              stage: station === 'assembly' ? 'checking' : 'accepted',
            }),
            employees: people.map((e) => ({
              employeeId: e.id,
              employeeName: e.name,
              employeeInitials: e.initials,
            })),
          };
        },
      },
    );
  }
  async cut(ctx: UnitOfWorkContext, allocationId: string, actor: string) {
    const before = await ctx.production.recutForPlan(allocationId);
    if (!before || before.stage !== 'cutting')
      throw new ConflictException(
        'The replacement is no longer awaiting cutting.',
      );
    const row = await ctx.production.updateRecut(before.id, {
      stage: 'assembly',
    });
    await this.audit.record(ctx, actor, 'recut.cut', [
      changeSnapshot({ before, row }),
    ]);
  }
  // All recut transitions and shipping serialize on the same order row. Take
  // an existing replacement allocation lock first, as worksheet submission does.
  private write(
    action: string,
    input: object,
    actor: string,
    key: string,
    target: WriteTarget,
  ) {
    return productionOperation(() =>
      this.uow.transaction(async (ctx) => {
        let orderId = target.id;
        if (target.kind === 'recut') {
          const initial = await this.find(ctx, target.id);
          if (initial.allocationId)
            await this.allocations.lockAllocation(ctx, initial.allocationId);
          orderId = initial.workOrderId;
        }
        const order = await this.orders.requireOrder(ctx, orderId);
        const scope = `recut.${action}`;
        const replay = await this.audit.replay(
          ctx,
          actor,
          scope,
          target.id,
          key,
          input,
        );
        if (replay.result) return replay.result;
        this.orders.assertNotCancelled(order);
        if (!order.allocatedAt)
          throw new ConflictException(
            'Allocate fabric before requesting a replacement.',
          );
        let change: Change;
        if (target.kind === 'order') {
          change = await target.apply(ctx, order);
        } else {
          const current = await this.find(ctx, target.id);
          if (current.revision !== target.expectedRevision)
            throw new ConflictException(
              'Recut changed. Refresh before submitting.',
            );
          change = await target.apply(ctx, current);
        }
        const eventId = await this.audit.record(
          ctx,
          actor,
          scope,
          [changeSnapshot(change)],
          change.reason,
        );
        return this.audit.remember(
          ctx,
          actor,
          scope,
          target.id,
          key,
          replay.requestHash,
          {
            eventId,
            recordId: change.row.id,
            revision: change.row.revision,
            affectedAllocationIds: [],
            createdStockItemIds: [],
          },
        );
      }),
    );
  }
}
