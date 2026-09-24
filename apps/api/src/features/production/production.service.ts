import { ConflictException, Injectable } from '@nestjs/common';
import {
  type MilestoneCorrection,
  type StationQuery,
} from '@roller-bay/shared/production';
import type { Station } from '@roller-bay/shared/users';
import type { AuditChange } from '@roller-bay/shared/audit';
import type { UnitOfWorkContext } from '../../unit-of-work/unit-of-work-context.js';
import {
  type WorkOrderRecord,
  presentWorkOrder,
  WorkOrdersService,
} from '../work-orders/index.js';
import { milestoneTimestampField } from '../work-orders/tables.js';
import type {
  CompletionRecord,
  CompletionValues,
} from './production-completions.table.js';
import { UnitOfWork } from '../../unit-of-work/unit-of-work.js';
import { AuditService } from '../audit/index.js';
import { EmployeesService } from '../employees/index.js';
import type { Employee } from '@roller-bay/shared/employees';
import { productionOperation } from './production.operation.js';
import {
  presentCompletion,
  presentStationOrders,
} from './production.presenter.js';
const credited = ({ id, name, initials }: Employee) => ({
  employeeId: id,
  employeeName: name,
  employeeInitials: initials,
});
// Attribution is a set; the input schema already sorts the requested ids.
const sameEmployees = (completion: CompletionRecord, employeeIds: string[]) =>
  completion.employees.length === employeeIds.length &&
  completion.employees
    .map((e) => e.employeeId)
    .sort()
    .every((id, i) => id === employeeIds[i]);
@Injectable()
export class ProductionService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly orders: WorkOrdersService,
    private readonly employees: EmployeesService,
    private readonly audit: AuditService,
  ) {}
  list(id: string) {
    return productionOperation(() =>
      this.unitOfWork.readOnlyTransaction(async (context) => {
        await this.orders.requireOrder(context, id, false);
        return (await context.production.completions(id)).map(
          presentCompletion,
        );
      }),
    );
  }
  async listOrders(station: Station, query: StationQuery) {
    return productionOperation(async () =>
      presentStationOrders(
        await this.unitOfWork.readOnlyTransaction(async (context) =>
          context.production.list(station, query),
        ),
      ),
    );
  }
  complete(
    id: string,
    station: Station,
    employeeIds: string[],
    actor: string,
    key: string,
  ) {
    return productionOperation(() =>
      this.unitOfWork.transaction(async (context) => {
        const order = await this.orders.requireOrder(context, id);
        const scope = `production.${station}.complete`;
        const replay = await this.audit.replay(context, actor, scope, id, key, {
          employeeIds,
        });
        if (replay.result) return replay.result;
        this.orders.assertNotCancelled(order);
        if (!order.allocatedAt)
          throw new ConflictException(
            'Allocate fabric before recording production.',
          );
        const before = (await context.production.completions(id)).find(
          (r) => r.station === station,
        );
        let eventId: string;
        let revision = order.revision;
        if (order[milestoneTimestampField[station]]) {
          if (!before || !sameEmployees(before, employeeIds))
            throw new ConflictException(
              'Completion already recorded. An admin can correct its attribution.',
            );
          eventId = await this.confirmExistingCompletion(
            context,
            before,
            actor,
          );
        } else {
          const people = await this.employees.requireActiveMany(
            context,
            employeeIds,
          );
          const now = new Date();
          const saved = await this.saveMilestone(
            context,
            order,
            station,
            before,
            {
              employees: people.map(credited),
              completedAt: now,
              recordedAt: now,
              recordedByUserId: actor,
            },
          );
          revision = saved.revision;
          eventId = await this.audit.record(
            context,
            actor,
            `order.${station}.completed`,
            saved.changes,
          );
        }
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
            revision,
            affectedAllocationIds: [],
            createdStockItemIds: [],
          },
        );
      }),
    );
  }
  async recordWorksheetCut(
    context: UnitOfWorkContext,
    order: WorkOrderRecord,
    employeeIds: string[],
    actor: string,
    submittedAt: Date,
  ) {
    // Preserve historical manual completions and admin corrections.
    if (order.cutAt) return;
    const people = await this.employees.requireActiveMany(context, employeeIds);
    const before = (await context.production.completions(order.id)).find(
      (r) => r.station === 'cutting',
    );
    const saved = await this.saveMilestone(context, order, 'cutting', before, {
      employees: people.map(credited),
      completedAt: submittedAt,
      recordedAt: submittedAt,
      recordedByUserId: actor,
    });
    await this.audit.record(
      context,
      actor,
      'order.cutting.completed',
      saved.changes,
    );
  }
  correct(
    id: string,
    station: Station,
    input: MilestoneCorrection,
    actor: string,
    key: string,
  ) {
    return productionOperation(() =>
      this.unitOfWork.transaction(async (context) => {
        const order = await this.orders.requireOrder(context, id);
        const scope = `production.${station}.correct`;
        const replay = await this.audit.replay(
          context,
          actor,
          scope,
          id,
          key,
          input,
        );
        if (replay.result) return replay.result;
        // Historical facts remain correctable after cancellation or fabric release.
        if (input.expectedRevision !== order.revision)
          throw new ConflictException(
            'Order changed; refresh before correcting.',
          );
        const before = (await context.production.completions(id)).find(
          (r) => r.station === station,
        );
        const people = input.employeeIds
          ? await this.employees.requireActiveMany(context, input.employeeIds)
          : null;
        const now = new Date();
        const completedAt = input.completedAt
          ? new Date(input.completedAt)
          : null;
        if (completedAt && completedAt > now)
          throw new ConflictException(
            'Completion time cannot be in the future.',
          );
        const next =
          people && completedAt
            ? {
                employees: people.map(credited),
                completedAt,
                recordedAt: now,
                recordedByUserId: actor,
              }
            : null;
        const saved = await this.saveMilestone(
          context,
          order,
          station,
          before,
          next,
        );
        const eventId = await this.audit.record(
          context,
          actor,
          `order.${station}.corrected`,
          saved.changes,
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
            revision: saved.revision,
            affectedAllocationIds: [],
            createdStockItemIds: [],
          },
        );
      }),
    );
  }
  private confirmExistingCompletion(
    context: UnitOfWorkContext,
    completion: CompletionRecord,
    actor: string,
  ) {
    // A distinct confirmation records an acknowledgement, so its retry remains
    // safe even if an admin later clears or corrects the original milestone.
    const snapshot = {
      type: 'production' as const,
      value: presentCompletion(completion),
    };
    return this.audit.record(
      context,
      actor,
      `order.${completion.station}.completion-confirmed`,
      [
        {
          recordType: 'production',
          recordId: completion.workOrderId,
          before: snapshot,
          after: snapshot,
        },
      ],
    );
  }
  private async saveMilestone(
    context: UnitOfWorkContext,
    order: WorkOrderRecord,
    station: Station,
    before: CompletionRecord | undefined,
    next: CompletionValues | null,
  ) {
    await context.production.save(order.id, station, next);
    const after = await this.orders.recordProductionMilestone(
      context,
      order.id,
      station,
      next?.completedAt ?? null,
    );
    const changes: AuditChange[] = [
      {
        recordType: 'work-orders',
        recordId: order.id,
        before: { type: 'work-orders', value: presentWorkOrder(order) },
        after: { type: 'work-orders', value: presentWorkOrder(after!) },
      },
      {
        recordType: 'production',
        recordId: order.id,
        before: before
          ? { type: 'production', value: presentCompletion(before) }
          : null,
        after: next
          ? {
              type: 'production',
              value: presentCompletion({
                ...next,
                workOrderId: order.id,
                station,
              }),
            }
          : null,
      },
    ];
    return { revision: after!.revision, changes };
  }
}
