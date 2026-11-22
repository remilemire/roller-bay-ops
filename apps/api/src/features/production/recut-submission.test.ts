import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Test } from '@nestjs/testing';
import type { Recut } from '@roller-bay/shared/production';
import { UnitOfWork } from '../../unit-of-work/unit-of-work.js';
import { AllocationsService } from '../allocations/index.js';
import { AuditService } from '../audit/index.js';
import { CuttingWorksheetsService } from '../cutting-worksheets/index.js';
import { EmployeesService } from '../employees/index.js';
import { StockItemsService } from '../stock-items/index.js';
import { WorkOrdersService } from '../work-orders/index.js';
import { CuttingWorkflowService } from './cutting-workflow.service.js';
import { ProductionService } from './production.service.js';
import { RecutsService } from './recuts.service.js';

test('submitting replacement measurements advances only the replacement, once, even after a return', async (t) => {
  for (const needsAssembly of [false, true]) {
    await t.test(
      needsAssembly
        ? 'standard recut'
        : 'older request with the former route setting',
      async () => {
        const allocationId = randomUUID(),
          workOrderId = randomUUID(),
          actor = randomUUID();
        const task: Recut = {
          id: randomUUID(),
          allocationId,
          workOrderId,
          requirementId: randomUUID(),
          widthMm: 500,
          lengthMm: 1000,
          quantity: 1,
          fabricColorCode: 'LINEN',
          reason: 'Flaw',
          stage: 'cutting',
          revision: 2,
          needsAssembly,
        };
        const context = {
          production: {
            recutForPlan: async () => ({ ...task }),
            updateRecut: async (_id: string, change: Partial<Recut>) =>
              Object.assign(task, change, { revision: task.revision + 1 }),
          },
        };
        const id = randomUUID();
        const submittedAt = new Date().toISOString();
        const input = {
          expectedRevision: 1,
          results: {
            expectedRevision: 1,
            items: [
              {
                stockItemId: randomUUID(),
                expectedRevision: 1,
                outcome: 'consumed' as const,
                scraps: [],
              },
            ],
          },
        };
        let results: typeof input.results | null = null;
        const module = await Test.createTestingModule({
          providers: [
            CuttingWorkflowService,
            RecutsService,
            {
              provide: UnitOfWork,
              useValue: {
                transaction: (run: (value: typeof context) => unknown) =>
                  run(context),
              },
            },
            {
              provide: AllocationsService,
              useValue: { lockAllocation: async () => ({}) },
            },
            {
              provide: WorkOrdersService,
              useValue: {
                requireOrder: async () => ({
                  id: workOrderId,
                  allocatedAt: submittedAt,
                }),
                assertNotCancelled: () => {},
              },
            },
            {
              provide: CuttingWorksheetsService,
              useValue: {
                requireRecord: async () => ({
                  id,
                  allocationId,
                  workOrderId,
                  snapshot: { isRecut: true },
                  results,
                }),
                submitInTransaction: async () => {
                  results = input.results;
                  return { submittedAt, employees: [{ employeeId: actor }] };
                },
              },
            },
            {
              provide: ProductionService,
              useValue: {
                recordWorksheetCut: () =>
                  assert.fail(
                    'A recut must preserve the original cut attribution',
                  ),
              },
            },
            {
              provide: AuditService,
              useValue: { record: async () => randomUUID() },
            },
            { provide: EmployeesService, useValue: {} },
            { provide: StockItemsService, useValue: {} },
          ],
        }).compile();
        try {
          const workflow = module.get(CuttingWorkflowService);
          await workflow.submit(id, input, actor);
          await workflow.submit(id, { ...input, expectedRevision: 3 }, actor);
          assert.equal(task.stage, 'assembly');
          assert.equal(task.revision, 3);
        } finally {
          await module.close();
        }
      },
    );
  }
});
