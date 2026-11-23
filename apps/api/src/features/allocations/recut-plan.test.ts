import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { ConfiguredAllocationPlan } from './cutting-rules.service.js';
import type { UnitOfWorkContext } from '../../unit-of-work/unit-of-work-context.js';
import { UnitOfWork } from '../../unit-of-work/unit-of-work.js';
import { AuditService } from '../audit/index.js';
import { StockItemsService } from '../stock-items/index.js';
import { CuttingWorksheetsService } from '../cutting-worksheets/index.js';
import { WorkOrdersService } from '../work-orders/index.js';
import { CuttingPlanOptimizer } from './optimizer/cutting-plan-optimizer.js';
import { CuttingRulesService } from './cutting-rules.service.js';
import { AllocationDetailsService } from './allocation-details.service.js';
import { AllocationsService } from './allocations.service.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recutLayout } from './recut-plan.js';
test('replacement rows allow both edge trims and apply the drop allowance once per row', () => {
  const rules = { edgeTrimMm: 10.001, dropAllowanceMm: 25.004 };
  const blind = { widthMm: 500.002, lengthMm: 1000.001, quantity: 5 };
  assert.deepEqual(recutLayout(1020.006, blind, rules), {
    across: 2,
    rows: 3,
    length: 3075015n,
  });
  assert.deepEqual(recutLayout(1020.005, blind, rules), {
    across: 1,
    rows: 5,
    length: 5125025n,
  });
  assert.equal(recutLayout(520.003, blind, rules), null);
});

test('group stock preview and reservation use the same mixed-size layout and recheck available length', async () => {
  const fabricColorId = randomUUID();
  const requirements = [200, 300, 400].map((widthMm, i) => ({
    id: randomUUID(),
    fabricColorId,
    widthMm,
    lengthMm: 600 + 50 * i,
    quantity: 1,
  }));
  const wide = {
    id: randomUUID(),
    fabricColorId,
    widthMm: 920,
    remainingLengthMm: 750,
    voidedAt: null,
    consumedAt: null,
    isRemnant: false,
    isUsed: false,
    locationLabel: 'A',
  };
  const narrow = { ...wide, id: randomUUID(), widthMm: 410 };
  const sourceId = randomUUID(),
    workOrderId = randomUUID();
  const reserved = new Map<string, string>();
  const savedPlans = new Map<string, ConfiguredAllocationPlan>();
  const ctx = {
    allocations: {
      findById: async () => ({
        workOrderId,
        settings: {
          edgeTrimMm: 10,
          minimumRemnantWidthMm: 100,
          minimumRemnantLengthMm: 150,
          dropAllowanceMm: 50,
        },
      }),
      reservations: async () => reserved,
      create: async () => ({ id: randomUUID() }),
      replacePlan: (id: string, input: ConfiguredAllocationPlan) =>
        savedPlans.set(id, input),
      initializePlan: async () => {},
    },
  } as unknown as UnitOfWorkContext;
  const module = await Test.createTestingModule({
    providers: [
      AllocationsService,
      {
        provide: StockItemsService,
        useValue: {
          requireColors: async () => {},
          findForAllocation: async (
            _ctx: unknown,
            filter: { stockIds?: string[] },
          ) =>
            [wide, narrow].filter(
              (s) => !filter.stockIds || filter.stockIds.includes(s.id),
            ),
        },
      },
      {
        provide: CuttingWorksheetsService,
        useValue: { reportedConsumedStockIds: async () => new Set() },
      },
      {
        provide: CuttingPlanOptimizer,
        useValue: new CuttingPlanOptimizer(null),
      },
      {
        provide: CuttingRulesService,
        useValue: new CuttingRulesService(new ConfigService()),
      },
      ...[
        UnitOfWork,
        AuditService,
        WorkOrdersService,
        AllocationDetailsService,
      ].map((provide) => ({ provide, useValue: {} })),
    ],
  }).compile();
  try {
    const service = module.get(AllocationsService);
    const candidates = await service.recutStock(ctx, sourceId, requirements);
    assert.deepEqual(
      candidates.map((s) => s.id),
      [wide.id],
    );
    const reserve = () =>
      service.reserveRecut(
        ctx,
        sourceId,
        workOrderId,
        requirements,
        wide.id,
        randomUUID(),
      );
    reserved.set(wide.id, '0.001');
    await assert.rejects(reserve, ConflictException);
    assert.equal(savedPlans.size, 0);
    reserved.clear();
    const id = await reserve();
    const { plan } = savedPlans.get(id)!;
    assert.equal(plan.cuts.length, 1);
    assert.equal(plan.cuts[0]!.stockItemId, wide.id);
    assert.equal(plan.cuts[0]!.lengthMm, 750);
    assert.equal(plan.cuts[0]!.items.length, 3);
  } finally {
    await module.close();
  }
});
