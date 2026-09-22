import { ConflictException, Injectable } from '@nestjs/common';
import {
  type StationQuery,
  type MilestoneCorrection,
} from '@roller-bay/shared/production';
import type { Station } from '@roller-bay/shared/users';
import { EmployeesService } from '../employees/employees.service.js';
import { DatabaseService } from '../../database/database.service.js';
import {
  presentCompletion,
  presentStationOrders,
} from './production.presenter.js';
import { AuditService } from '../audit/audit.service.js';
import { WorkOrdersService } from '../work-orders/work-orders.service.js';
import { ProductionRepository } from './production.repository.js';
import { milestoneTimestampField } from '../work-orders/work-order-milestones.js';
import { presentWorkOrder } from '../work-orders/work-orders.presenter.js';
import { productionOperation } from './production.operation.js';
@Injectable()
export class ProductionService {
  constructor(
    private readonly repository: ProductionRepository,
    private readonly database: DatabaseService,
    private readonly orders: WorkOrdersService,
    private readonly employees: EmployeesService,
    private readonly audit: AuditService,
  ) {}
  list(id: string) {
    return productionOperation(() =>
      this.database.transaction(async (tx) => {
        await this.orders.getForProduction(tx, id, false);
        return (await this.repository.completions(tx, id)).map(
          presentCompletion,
        );
      }, true),
    );
  }
  async listOrders(station: Station, query: StationQuery) {
    return productionOperation(async () =>
      presentStationOrders(await this.repository.list(station, query)),
    );
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
    return productionOperation(() =>
      this.database.transaction(async (tx) => {
        const order = await this.orders.getForProduction(tx, id);
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
        const before = (await this.repository.completions(tx, id)).find(
          (r) => r.station === station,
        );
        if (!correction && order[milestoneTimestampField[station]]) {
          if (!before || before.employeeId !== input.employeeId)
            throw new ConflictException(
              'Completion already recorded. An admin can correct its attribution.',
            );
          // A distinct confirmation leaves the milestone intact, but records its
          // acknowledgement so that this key remains safe after later corrections.
          const snapshot = {
            type: 'production' as const,
            value: presentCompletion(before),
          };
          const eventId = await this.audit.record(
            tx,
            actor,
            `order.${station}.completion-confirmed`,
            [
              {
                recordType: 'production',
                recordId: id,
                before: snapshot,
                after: snapshot,
              },
            ],
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
              revision: order.revision,
              affectedAllocationIds: [],
              createdStockItemIds: [],
            },
          );
        }
        const employee = input.employeeId
          ? await this.employees.requireActive(tx, input.employeeId)
          : null;
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
        await this.repository.save(tx, id, station, next);
        const after = await this.orders.recordProductionMilestone(
          tx,
          id,
          station,
          completedAt,
        );
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
