import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  allocationDraftDataSchema,
  allocationDraftInputSchema,
  allocationIdempotencyKeySchema,
  completeAllocationSchema,
  createAllocationSchema,
  optimizeAllocationSchema,
  replaceAllocationSchema,
} from '@roller-bay/shared/allocations';
import { stockCuttingOutcomeSchema } from '@roller-bay/shared/stock-items';
import { allocationOperation } from './allocations.operation.js';
import { requireActiveRevision } from './allocation.rules.js';
import type { AllocationRecord } from './allocations.repository.js';
import { fixture } from './optimizer/optimizer.fixtures.js';

function submission() {
  const context = fixture();
  return {
    orderNumber: ' 104801 ',
    requirements: context.requirements.map(
      ({ id, fabricColorId, widthMm, lengthMm, quantity }) => ({
        id,
        fabricColorId,
        widthMm,
        lengthMm,
        quantity,
      }),
    ),
    plan: {
      cuts: [
        {
          stockItemId: context.stockItems[0]!.id,
          items: [{ requirementId: context.requirements[0]!.id, quantity: 2 }],
        },
      ],
    },
  };
}

test('allocation contracts normalize keys, require revisions, and reject client-authoritative stock balances', () => {
  const input = submission();
  assert.equal(createAllocationSchema.parse(input).orderNumber, '104801');
  for (const orderNumber of ['10480', '1048010', 'RB-1048', '104 801'])
    assert.equal(
      createAllocationSchema.safeParse({ ...input, orderNumber }).success,
      false,
    );
  // Drafts name a scheduled order or none. Stored drafts and their audit
  // snapshots may still hold the partial numbers older versions accepted.
  assert.equal(
    allocationDraftInputSchema.parse({ orderNumber: ' 104801 ' }).orderNumber,
    '104801',
  );
  assert.equal(allocationDraftInputSchema.parse({}).orderNumber, null);
  for (const orderNumber of ['1048', 'RB-1']) {
    assert.equal(
      allocationDraftInputSchema.safeParse({ orderNumber }).success,
      false,
    );
    assert.equal(
      allocationDraftDataSchema.parse({ orderNumber }).orderNumber,
      orderNumber,
    );
  }
  assert.equal(replaceAllocationSchema.safeParse(input).success, false);
  assert.equal(
    replaceAllocationSchema.safeParse({ ...input, expectedRevision: 1 })
      .success,
    true,
  );
  assert.equal(
    createAllocationSchema.safeParse({ ...input, stockItems: [] }).success,
    false,
  );
  const { requirements } = input;
  assert.equal(
    optimizeAllocationSchema.safeParse({
      requirements,
      allocationId: randomUUID(),
    }).success,
    false,
  );
  assert.equal(
    optimizeAllocationSchema.safeParse({
      requirements,
      expectedRevision: 1,
    }).success,
    false,
  );
  assert.equal(
    optimizeAllocationSchema.safeParse({
      requirements,
      allocationId: randomUUID(),
      expectedRevision: 1,
    }).success,
    true,
  );
  const key = randomUUID();
  assert.equal(allocationIdempotencyKeySchema.parse(key.toUpperCase()), key);
});

test('completion contracts distinguish roll/remnant measurements and cap retained-scrap expansion', () => {
  const base = {
    stockItemId: randomUUID(),
    expectedRevision: 1,
  };
  const roll = {
    ...base,
    outcome: 'returned-roll',
    radialDepthMm: 1.125,
    tubeOuterDiameterMm: 50,
    locationId: randomUUID(),
  };
  assert.equal(stockCuttingOutcomeSchema.safeParse(roll).success, true);
  for (const wrong of [
    { ...roll, tubeOuterDiameterMm: 50.0005 },
    { ...roll, radialDepthMm: 1.1251 },
    { ...roll, explicitLengthMm: 100 },
    { ...roll, remainingLengthMm: 100 },
  ])
    assert.equal(stockCuttingOutcomeSchema.safeParse(wrong).success, false);
  const remnant = {
    ...base,
    outcome: 'returned-remnant',
    widthMm: 500,
    explicitLengthMm: 1000,
    locationId: randomUUID(),
  };
  assert.equal(stockCuttingOutcomeSchema.safeParse(remnant).success, true);
  assert.equal(
    stockCuttingOutcomeSchema.safeParse({ ...remnant, radialDepthMm: 1 })
      .success,
    false,
  );
  assert.equal(
    completeAllocationSchema.safeParse({
      expectedRevision: 1,
      items: [
        {
          ...base,
          outcome: 'consumed',
          scraps: Array.from({ length: 11 }, () => ({
            widthMm: 100,
            lengthMm: 100,
            locationId: randomUUID(),
            quantity: 100,
          })),
        },
      ],
    }).success,
    false,
  );
});

test('allocation storage errors preserve domain responses and do not expose driver details', async () => {
  const conflict = new ConflictException('Already completed.');
  await assert.rejects(
    allocationOperation(async () => {
      throw conflict;
    }),
    (error) => error === conflict,
  );
  for (const [code, status] of [
    ['23503', 404],
    ['23505', 409],
    ['23514', 400],
    ['22003', 400],
    ['40001', 409],
    ['55P03', 409],
    ['40P01', 409],
  ]) {
    await assert.rejects(
      allocationOperation(async () => {
        throw { cause: { code, message: 'secret driver detail' } };
      }),
      (error: unknown) =>
        error instanceof Error &&
        'getStatus' in error &&
        (error as BadRequestException).getStatus() === status &&
        !error.message.includes('secret'),
    );
  }
  // Order constraints answer with an issue the form places on the order number.
  for (const [code, constraint, status, issue] of [
    [
      '23503',
      'allocations_order_number_scheduled_orders_order_number_fk',
      404,
      'order_not_scheduled',
    ],
    [
      '23505',
      'allocations_live_order_number_unique',
      409,
      'order_already_allocated',
    ],
  ] as const)
    await assert.rejects(
      allocationOperation(async () => {
        throw { cause: { code, constraint, message: 'secret driver detail' } };
      }),
      (error: unknown) => {
        assert.ok(error instanceof HttpException);
        assert.equal(error.getStatus(), status);
        assert.deepEqual((error.getResponse() as { issues: object[] }).issues, [
          {
            code: issue,
            path: ['orderNumber'],
            message: (error.getResponse() as { issues: { message: string }[] })
              .issues[0]!.message,
          },
        ]);
        assert.doesNotMatch(error.message, /secret/);
        return true;
      },
    );
  await assert.rejects(
    allocationOperation(async () => {
      throw new Error('secret');
    }),
    ServiceUnavailableException,
  );
});

test('allocation revisions reject stale and terminal-state writes', () => {
  const row: AllocationRecord = {
    id: randomUUID(),
    orderNumber: 'A',
    createdByUserId: randomUUID(),
    createdAt: new Date(),
    updatedAt: new Date(),
    isDraft: false,
    revision: 2,
    confirmedAt: new Date(),
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
  };
  assert.equal(requireActiveRevision(row, 2), row);
  assert.throws(() => requireActiveRevision(row, 1), ConflictException);
  assert.throws(
    () => requireActiveRevision({ ...row, completedAt: new Date() }, 2),
    ConflictException,
  );
  assert.throws(
    () => requireActiveRevision({ ...row, cancelledAt: new Date() }, 2),
    ConflictException,
  );
});
