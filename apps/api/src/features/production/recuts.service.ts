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
  type RecutSelection,
  type RecutAssignment,
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
const replacementBlind = ({
  id,
  fabricColorId,
  widthMm,
  lengthMm,
  quantity,
}: Row) => ({ id, fabricColorId, widthMm, lengthMm, quantity });
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
      apply: (
        context: UnitOfWorkContext,
        recut: Row,
      ) => Promise<Change | Change[]>;
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
  pendingCount() {
    return productionOperation(() =>
      this.uow.readOnlyTransaction((ctx) => ctx.production.pendingRecutCount()),
    );
  }
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
  private async selectedRequests(
    ctx: UnitOfWorkContext,
    primary: Row,
    input: RecutSelection,
  ) {
    if (primary.stage !== 'requested')
      throw new ConflictException('This recut is no longer awaiting fabric.');
    if (!input.additionalRecuts?.length) return [primary];
    const pending = new Map(
      (await ctx.production.openRecuts(primary.workOrderId)).map((r) => [
        r.id,
        r,
      ]),
    );
    return [
      primary,
      ...input.additionalRecuts.map(({ id, expectedRevision }) => {
        const row = pending.get(id);
        if (
          !row ||
          row.stage !== 'requested' ||
          row.revision !== expectedRevision
        )
          throw new ConflictException(
            'A selected recut changed. Refresh the assignment.',
          );
        if (
          id === primary.id ||
          row.sourceId !== primary.sourceId ||
          row.fabricColorId !== primary.fabricColorId
        )
          throw new BadRequestException(
            'Select distinct requests for the same order and fabric.',
          );
        return row;
      }),
    ];
  }
  candidates(id: string, input: RecutSelection = {}, partial = false) {
    return productionOperation(() =>
      this.uow.readOnlyTransaction(async (ctx) => {
        const row = await this.find(ctx, id);
        const requests =
          partial || input.additionalRecuts?.length
            ? await this.selectedRequests(ctx, row, input)
            : [row];
        return this.allocations.recutStock(
          ctx,
          row.sourceId,
          requests.map(replacementBlind),
          undefined,
          partial,
        );
      }),
    );
  }
  request(orderId: string, input: RequestInput, actor: string, key: string) {
    return this.write('requested', input, actor, key, {
      kind: 'order',
      id: orderId,
      apply: async (ctx, order) => {
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
  previewManual(
    id: string,
    input: Extract<RecutAssignment, { plan: unknown }>,
  ) {
    return productionOperation(() =>
      this.uow.readOnlyTransaction(async (ctx) => {
        const primary = await this.find(ctx, id);
        if (primary.revision !== input.expectedRevision)
          throw new ConflictException('Recut changed. Reopen the assignment.');
        const requests = await this.selectedRequests(ctx, primary, input);
        const { summary } = await this.allocations.manualRecutPlan(
          ctx,
          primary.sourceId,
          primary.workOrderId,
          requests.map(replacementBlind),
          input.plan,
          false,
        );
        return summary;
      }),
    );
  }
  assign(id: string, input: RecutAssignment, actor: string, key: string) {
    return this.write('assigned', input, actor, key, {
      kind: 'recut',
      id,
      expectedRevision: input.expectedRevision,
      apply: async (ctx, before) => {
        const requests = await this.selectedRequests(ctx, before, input);
        const allocationId =
          'plan' in input
            ? await this.allocations.reserveManualRecut(
                ctx,
                before.sourceId,
                before.workOrderId,
                requests.map(replacementBlind),
                input.plan,
                actor,
              )
            : await this.allocations.reserveRecut(
                ctx,
                before.sourceId,
                before.workOrderId,
                requests.map(replacementBlind),
                input.stockItemId,
                actor,
              );
        const changes: Change[] = [];
        for (const request of requests) {
          changes.push({
            before: request,
            row: await ctx.production.updateRecut(request.id, {
              stage: 'cutting',
              allocationId,
            }),
          });
        }
        return changes;
      },
    });
  }
  withdraw(
    id: string,
    input: {
      expectedRevision: number;
      reason: string;
      unusedWorksheet?: { id: string; expectedRevision: number };
    },
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
        const changes: Change[] = [];
        if (before.allocationId) {
          const stockIds = await this.allocations.releaseUnusedRecut(
            ctx,
            before.allocationId,
            actor,
            input.reason,
            input.unusedWorksheet,
          );
          if (before.stage === 'cutting') {
            const remaining = (
              await ctx.production.recutsForPlan(before.allocationId)
            ).filter((r) => r.id !== id && r.stage === 'cutting');
            if (remaining.length) {
              const allocationId =
                await this.allocations.reassignRemainingRecuts(
                  ctx,
                  before.sourceId,
                  before.workOrderId,
                  remaining.map(replacementBlind),
                  stockIds ?? [],
                  actor,
                );
              for (const other of remaining) {
                changes.push({
                  before: other,
                  row: await ctx.production.updateRecut(other.id, {
                    stage: allocationId ? 'cutting' : 'requested',
                    allocationId,
                  }),
                });
              }
            }
          }
        }
        return [
          {
            before,
            row: await ctx.production.updateRecut(id, { stage: 'withdrawn' }),
            reason: input.reason,
          },
          ...changes,
        ];
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
    const group = await ctx.production.recutsForPlan(allocationId);
    if (!group.length || group.some((r) => r.stage !== 'cutting'))
      throw new ConflictException(
        'The replacement is no longer awaiting cutting.',
      );
    const changes: AuditChange[] = [];
    for (const before of group) {
      const row = await ctx.production.updateRecut(before.id, {
        stage: 'assembly',
      });
      changes.push(changeSnapshot({ before, row }));
    }
    await this.audit.record(ctx, actor, 'recut.cut', changes);
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
        let result: Change | Change[];
        if (target.kind === 'order') {
          result = await target.apply(ctx, order);
        } else {
          const current = await this.find(ctx, target.id);
          if (current.revision !== target.expectedRevision)
            throw new ConflictException(
              'Recut changed. Refresh before submitting.',
            );
          result = await target.apply(ctx, current);
        }
        const changes = Array.isArray(result) ? result : [result];
        const change = changes[0]!;
        const eventId = await this.audit.record(
          ctx,
          actor,
          scope,
          changes.map(changeSnapshot),
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
