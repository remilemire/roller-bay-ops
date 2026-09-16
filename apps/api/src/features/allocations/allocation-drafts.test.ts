import { ConfigService } from '@nestjs/config';
import { CuttingRulesService } from './cutting-rules.service.js';
import { AllocationsService } from './allocations.service.js';
import type { StockItemsService } from '../stock-items/stock-items.service.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import {
  allocationDraftDataSchema,
  createAllocationSchema,
} from '@roller-bay/shared/allocations';
import {
  requireActiveRevision,
  requireDraftRevision,
  requirePlanningRevision,
} from './allocation.rules.js';
import {
  AllocationsRepository,
  type AllocationRecord,
} from './allocations.repository.js';
import { allocationSummary } from './allocations.presenter.js';

const header = (): AllocationRecord => ({
  id: randomUUID(),
  orderNumber: null,
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
  completedAt: null,
  cancelledAt: null,
});

test('allocation drafts preserve missing values and reject invalid supplied fields and foreign assignments', () => {
  const id = randomUUID();
  const data = allocationDraftDataSchema.parse({
    requirements: [{ id }],
    plan: { drops: [{ items: [{ requirementId: id }] }, {}] },
  });
  assert.equal(data.orderNumber, null);
  assert.equal(data.requirements[0]!.quantity, null);
  assert.equal(data.requirements[0]!.lengthAllowanceMm, null);
  assert.equal(data.settings.edgeTrimMm, null);
  assert.equal(data.plan.drops[0]!.stockItemId, null);
  assert.equal(data.plan.drops[0]!.items[0]!.quantity, null);
  assert.deepEqual(allocationDraftDataSchema.parse(data), data);
  assert.equal(createAllocationSchema.safeParse(data).success, false);
  for (const invalid of [
    { requirements: [{ id, widthMm: 0 }] },
    { requirements: [{ id, lengthMm: 1.0001 }] },
    { requirements: [{ id, fabricColorId: 'fake' }] },
    { requirements: [{ id }, { id }] },
    {
      requirements: [{ id }],
      plan: { drops: [{ items: [{ requirementId: randomUUID() }] }] },
    },
    {
      requirements: [{ id }],
      plan: {
        drops: [{ items: [{ requirementId: id }, { requirementId: id }] }],
      },
    },
    { settings: { edgeTrimMm: -1 } },
    { plan: { drops: [{}] }, stockItems: [] },
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
  const repository = new AllocationsRepository({ db });
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
  const draft = { ...header(), orderNumber: 'INCOMPLETE' };
  let writes = 0;
  const repository = {
    withTransaction: async (
      operation: (
        repository: unknown,
        transaction: unknown,
      ) => Promise<unknown>,
    ) => operation(repository, {}),
    findById: async () => draft,
    requirements: async () => [],
    plan: async () => ({ drops: [] }),
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
  const service = new AllocationsService(
    repository as unknown as AllocationsRepository,
    stock as unknown as StockItemsService,
    new CuttingRulesService(
      new ConfigService({
        CUTTING_EDGE_TRIM_MM: 1,
        CUTTING_MINIMUM_REMNANT_WIDTH_MM: 100,
        CUTTING_MINIMUM_REMNANT_LENGTH_MM: 100,
        CUTTING_DROP_ALLOWANCE_MM: 0,
      }),
    ),
  );
  await assert.rejects(service.submitDraft(draft.id, 1), BadRequestException);
  assert.equal(writes, 0);
  assert.equal(draft.confirmedAt, null);
});
