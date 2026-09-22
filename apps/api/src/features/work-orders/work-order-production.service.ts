import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  productionCompletionSchema,
  type MilestoneCorrection,
} from '@roller-bay/shared/production';
import type { Station } from '@roller-bay/shared/users';
import { EmployeesRepository } from '../employees/employees.repository.js';
import { AuditService } from '../audit/audit.service.js';
import { WorkOrdersRepository } from './work-orders.repository.js';
import {
  WorkOrderProductionRepository,
  milestoneColumn,
} from './work-order-production.repository.js';
import { presentWorkOrder } from './work-orders.presenter.js';
import { workOrdersOperation } from './work-orders.operation.js';
export const presentCompletion = (
  row: Awaited<
    ReturnType<WorkOrderProductionRepository['completions']>
  >[number],
) =>
  productionCompletionSchema.parse({
    ...row,
    completedAt: row.completedAt.toISOString(),
    recordedAt: row.recordedAt.toISOString(),
  });
@Injectable()
export class WorkOrderProductionService {
  constructor(
    private readonly repository: WorkOrdersRepository,
    private readonly audit: AuditService,
  ) {}
  list(id: string) {
    return this.repository.withTransaction(async (repo, tx) => {
      if (!(await repo.findById(id)))
        throw new NotFoundException('Order not found.');
      return (await new WorkOrderProductionRepository(tx).completions(id)).map(
        presentCompletion,
      );
    });
  }
  complete(
    id: string,
    station: Station,
    employeeId: string,
    actor: string,
    key: string,
  ) {
    return this.write(id, station, { employeeId }, actor, key);
  }
  correct(
    id: string,
    station: Station,
    input: MilestoneCorrection,
    actor: string,
    key: string,
  ) {
    return this.write(id, station, input, actor, key);
  }
  private write(
    id: string,
    station: Station,
    input: { employeeId: string } | MilestoneCorrection,
    actor: string,
    key: string,
  ) {
    return workOrdersOperation(() =>
      this.repository.withTransaction(async (repo, tx) => {
        const order = await repo.findByIdForUpdate(id);
        if (!order) throw new NotFoundException('Order not found.');
        const correction = 'reason' in input;
        const scope = `production.${station}.${correction ? 'correct' : 'complete'}`;
        const replay = await this.audit.replay(
          tx,
          actor,
          scope,
          id,
          key,
          input,
        );
        if (replay.result) return replay.result;
        if (!order.allocatedAt)
          throw new ConflictException(
            'Allocate fabric before recording production.',
          );
        if (correction && input.expectedRevision !== order.revision)
          throw new ConflictException(
            'Order changed; refresh before correcting.',
          );
        const production = new WorkOrderProductionRepository(tx);
        const before = (await production.completions(id)).find(
          (r) => r.station === station,
        );
        if (!correction && order[milestoneColumn[station]]) {
          if (!before || before.employeeId !== input.employeeId)
            throw new ConflictException(
              'Completion already recorded. An admin can correct its attribution.',
            );
          // Distinct duplicate submissions never replace the first employee or timestamp.
          return {
            eventId: null,
            recordId: id,
            revision: order.revision,
            affectedAllocationIds: [],
            createdStockItemIds: [],
          };
        }
        const employee = input.employeeId
          ? await new EmployeesRepository({ db: tx }).find(
              input.employeeId,
              true,
            )
          : null;
        if (input.employeeId && !employee?.isActive)
          throw new ConflictException('Choose an active employee.');
        const now = new Date();
        const completedAt = correction
          ? input.completedAt
            ? new Date(input.completedAt)
            : null
          : now;
        if (completedAt && completedAt > now)
          throw new ConflictException(
            'Completion time cannot be in the future.',
          );
        const next =
          employee && completedAt
            ? {
                employeeId: employee.id,
                employeeName: employee.name,
                employeeInitials: employee.initials,
                completedAt,
                recordedAt: now,
                recordedByUserId: actor,
              }
            : null;
        await production.save(id, station, next);
        const after = await repo.findById(id);
        const eventId = await this.audit.record(
          tx,
          actor,
          `order.${station}.${correction ? 'corrected' : 'completed'}`,
          [
            {
              recordType: 'work-orders',
              recordId: id,
              before: { type: 'work-orders', value: presentWorkOrder(order) },
              after: { type: 'work-orders', value: presentWorkOrder(after!) },
            },
            {
              recordType: 'production',
              recordId: id,
              before: before
                ? { type: 'production', value: presentCompletion(before) }
                : null,
              after: next
                ? {
                    type: 'production',
                    value: presentCompletion({
                      ...next,
                      workOrderId: id,
                      station,
                    }),
                  }
                : null,
            },
          ],
          correction ? input.reason : null,
        );
        return this.audit.remember(
          tx,
          actor,
          scope,
          id,
          key,
          replay.requestHash,
          {
            eventId,
            recordId: id,
            revision: after!.revision,
            affectedAllocationIds: [],
            createdStockItemIds: [],
          },
        );
      }),
    );
  }
}
