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

test('replacement submission advances the recut once and completes only a deferred whole-order cut', async (t) => {
  for (const scenario of [
    {
      name: 'replacement after a normal cut',
      needsAssembly: true,
      deferred: false,
      moreCuts: false,
      completions: 0,
    },
    {
      name: 'legacy routing choice',
      needsAssembly: false,
      deferred: false,
      moreCuts: false,
      completions: 0,
    },
    {
      name: 'another replacement still needs cutting',
      needsAssembly: true,
      deferred: true,
      moreCuts: true,
      completions: 0,
    },
    {
      name: 'last replacement completes a deferred cut once',
      needsAssembly: true,
      deferred: true,
      moreCuts: false,
      completions: 1,
    },
  ]) {
    await t.test(scenario.name, async () => {
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
        needsAssembly: scenario.needsAssembly,
      };
      const tasks = [task, { ...task, id: randomUUID(), reason: 'Short roll' }];
      const context = {
        production: {
          hasUncutRecuts: async () => scenario.moreCuts,
          recutsForPlan: async () => tasks.map((row) => ({ ...row })),
          updateRecut: async (id: string, change: Partial<Recut>) => {
            const row = tasks.find((r) => r.id === id)!;
            return Object.assign(row, change, { revision: row.revision + 1 });
          },
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
      const recordCut = t.mock.fn();
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
                cutAwaitingRecuts: scenario.deferred,
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
              recordWorksheetCut: recordCut,
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
        for (const replacement of tasks) {
          assert.equal(replacement.stage, 'assembly');
          assert.equal(replacement.revision, 3);
        }
        assert.equal(recordCut.mock.callCount(), scenario.completions);
      } finally {
        await module.close();
      }
    });
  }
});
