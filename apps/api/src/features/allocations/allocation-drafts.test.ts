import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  allocationDraftDataSchema,
  createAllocationSchema,
} from '@roller-bay/shared/allocations';
import { drizzle } from 'drizzle-orm/node-postgres';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { stubUnitOfWork } from '../../testing/unit-of-work.js';
import { AuditService } from '../audit/audit.service.js';
import type { CuttingWorksheetsService } from '../cutting-worksheets/cutting-worksheets.service.js';
import type { StockItemsService } from '../stock-items/stock-items.service.js';
import type { WorkOrdersService } from '../work-orders/work-orders.service.js';
import { AllocationDetailsService } from './allocation-details.service.js';
import {
  requireActiveRevision,
  requireDraftRevision,
  requirePlanningRevision,
} from './allocation.rules.js';
import { allocationSummary } from './allocations.presenter.js';
import {
  AllocationsRepository,
  type AllocationRecord,
} from './allocations.repository.js';
import { AllocationsService } from './allocations.service.js';
import { CuttingRulesService } from './cutting-rules.service.js';

const header = (): AllocationRecord => ({
  id: randomUUID(),
  workOrderId: randomUUID(),
  orderNumber: '104801',
  createdByUserId: randomUUID(),
  createdAt: new Date(),
  updatedAt: new Date(),
  isDraft: true,
  revision: 1,
  confirmedAt: null,
  submittedDraftRevision: null,
  settings: null,
  plannedSummary: null,
  idempotencyKey: null,
  requestHash: null,
  completionKey: null,
  completionRequestHash: null,
  completion: null,
  effectiveCompletion: null,
  correctedAt: null,
  stockEffects: null,
  completedAt: null,
  cancelledAt: null,
  releasedAt: null,
});

test('allocation drafts preserve missing values and reject invalid supplied fields and foreign assignments', () => {
  const id = randomUUID();
  const data = allocationDraftDataSchema.parse({
    requirements: [{ id }],
    plan: { cuts: [{ items: [{ requirementId: id }] }, {}] },
  });
  assert.equal(data.requirements[0]!.quantity, null);
  assert.equal(data.requirements[0]!.lengthAllowanceMm, null);
  assert.equal(data.settings.edgeTrimMm, null);
  assert.equal(data.plan.cuts[0]!.stockItemId, null);
  assert.equal(data.plan.cuts[0]!.items[0]!.quantity, null);
  assert.deepEqual(allocationDraftDataSchema.parse(data), data);
  assert.equal(createAllocationSchema.safeParse(data).success, false);
  for (const invalid of [
    { requirements: [{ id, widthMm: 0 }] },
    { requirements: [{ id, lengthMm: 1.0001 }] },
    { requirements: [{ id, fabricColorId: 'fake' }] },
    { requirements: [{ id }, { id }] },
    {
      requirements: [{ id }],
      plan: { cuts: [{ items: [{ requirementId: randomUUID() }] }] },
    },
    {
      requirements: [{ id }],
      plan: {
        cuts: [{ items: [{ requirementId: id }, { requirementId: id }] }],
      },
    },
    { settings: { edgeTrimMm: -1 } },
    { plan: { cuts: [{}] }, stockItems: [] },
  ])
    assert.equal(allocationDraftDataSchema.safeParse(invalid).success, false);
});

test('draft lifecycle rules distinguish planning from active operations and reject stale or terminal writes', () => {
  const row = header();
  assert.equal(requireDraftRevision(row, 1), row);
  assert.equal(requirePlanningRevision(row, 1), row);
  assert.throws(() => requireActiveRevision(row, 1), ConflictException);
  assert.throws(() => requireDraftRevision(row, 2), ConflictException);
  assert.throws(() => requireDraftRevision(undefined, 1), NotFoundException);
  assert.equal(allocationSummary(row, true).needsReplanning, false);
  assert.equal(allocationSummary(row, true).state, 'draft');
  const active = {
    ...row,
    orderNumber: 'ORDER',
    isDraft: false,
    confirmedAt: new Date(),
  };
  assert.equal(requireActiveRevision(active, 1), active);
  assert.throws(() => requireDraftRevision(active, 1), ConflictException);
  assert.throws(
    () => requirePlanningRevision({ ...active, cancelledAt: new Date() }, 1),
    ConflictException,
  );
});

test('all reservation and shortage SQL excludes unconfirmed allocations', async () => {
  const queries: string[] = [];
  const db = drizzle({
    client: {
      query: async (query: { text: string }) => {
        queries.push(query.text);
        return { rows: [] };
      },
    } as never,
  });
  const repository = new AllocationsRepository(db);
  await repository.reservations([randomUUID()]);
  await repository.affectedAllocations([randomUUID()]);
  assert.match(queries[0]!, /"allocations"\."is_draft" = \$1/i);
  assert.match(queries[1]!, /"allocations"\."is_draft" = \$1/i);
  assert.match(
    queries[1]!,
    /a\.is_draft = false AND a\.completed_at IS NULL AND a\.cancelled_at IS NULL/,
  );
});

test('incomplete allocation draft cannot reach reservation or confirmation writes', async () => {
  const draft = header();
  let writes = 0;
  const repository = {
    findById: async () => draft,
    plan: async () => ({ cuts: [] }),
    replacePlan: async () => {
      writes++;
    },
    update: async () => {
      writes++;
      return draft;
    },
  };
  const stock = {
    requireColors: async () => {
      writes++;
    },
  };
  // An incomplete draft reads its order's blinds, and must not claim it.
  const orders = {
    lines: async () => ({ lines: [] }),
    allocate: async () => {
      writes++;
    },
  };
  const cuttingRules = new CuttingRulesService(
    new ConfigService({
      CUTTING_EDGE_TRIM_MM: 1,
      CUTTING_MINIMUM_REMNANT_WIDTH_MM: 100,
      CUTTING_MINIMUM_REMNANT_LENGTH_MM: 100,
      CUTTING_DROP_ALLOWANCE_MM: 0,
    }),
  );
  const service = new AllocationsService(
    stubUnitOfWork({ allocations: repository }),
    {} as CuttingWorksheetsService,
    {} as AuditService,
    stock as unknown as StockItemsService,
    cuttingRules,
    orders as unknown as WorkOrdersService,
    new AllocationDetailsService(
      stock as unknown as StockItemsService,
      cuttingRules,
      orders as unknown as WorkOrdersService,
    ),
  );
  await assert.rejects(
    service.submitDraft(draft.id, 1, randomUUID()),
    BadRequestException,
  );
  assert.equal(writes, 0);
  assert.equal(draft.confirmedAt, null);
});
