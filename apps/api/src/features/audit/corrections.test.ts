import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  allocationCompletionSchema,
  completeAllocationRequestSchema,
  completeAllocationSchema,
} from '@roller-bay/shared/allocations';
import { auditChangeSchema } from '@roller-bay/shared/audit';
import {
  completionCorrectionSchema,
  receiptCorrectionSchema,
  stockCorrectionSchema,
} from '@roller-bay/shared/corrections';
import {
  stockCuttingOutcomeSchema,
  stockItemQuerySchema,
  stockSnapshotSchema,
} from '@roller-bay/shared/stock-items';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { DatabaseExecutor } from '../../database/database-executor.js';
import { stubUnitOfWork } from '../../testing/unit-of-work.js';
import type { UnitOfWorkContext } from '../../unit-of-work/unit-of-work-context.js';
import {
  cuttingWrite,
  retainedPieceWrite,
} from '../stock-items/stock-items.cutting.js';
import { AuditRepository } from './audit.repository.js';
import { AuditService, canonicalJson } from './audit.service.js';
const id = randomUUID(),
  color = randomUUID(),
  location = randomUUID(),
  now = new Date();
const before = stockSnapshotSchema.parse({
  id,
  fabricColorId: color,
  isRemnant: false,
  isUsed: false,
  widthMm: 2000,
  initialLengthMm: 10000,
  explicitLengthMm: null,
  radialDepthMm: null,
  tubeOuterDiameterMm: null,
  measurementThicknessMm: null,
  remainingLengthMm: 10000,
  locationId: location,
  sourceStockItemId: null,
  stockReceiptItemId: null,
  revision: 1,
  voidedAt: null,
  consumedAt: null,
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
});
test('corrections require a reason and stock revisions, and reject identity changes', () => {
  const value = {
    reason: '  Physical recount  ',
    expectedRevision: 2,
    changes: { widthMm: 1800 },
  };
  assert.equal(stockCorrectionSchema.parse(value).reason, 'Physical recount');
  for (const invalid of [
    { ...value, reason: ' ' },
    { ...value, reason: 'a'.repeat(1001) },
    { ...value, expectedRevision: 0 },
    { ...value, changes: {} },
    { ...value, changes: { fabricColorId: color } },
    { ...value, actorId: randomUUID() },
  ])
    assert.equal(stockCorrectionSchema.safeParse(invalid).success, false);
  assert.equal(
    stockCuttingOutcomeSchema.safeParse({
      stockItemId: id,
      outcome: 'consumed',
      expectedUpdatedAt: now.toISOString(),
    }).success,
    false,
  );
  assert.equal(stockItemQuerySchema.parse({ isVoided: 'true' }).isVoided, true);
});
test('receipt corrections distinguish quantity removal from deleting stock identities', () => {
  const data = {
    fabricColorId: color,
    widthMm: 2000,
    initialLengthMm: 10000,
    quantity: 1,
    locationId: location,
  };
  const parsed = receiptCorrectionSchema.parse({
    reason: 'One extra roll entered',
    expectedRevision: 1,
    operations: [
      {
        action: 'update',
        lineId: randomUUID(),
        data,
        removeStockItemIds: [id],
      },
    ],
    stockVersions: [{ stockItemId: id, expectedRevision: 1 }],
  });
  assert.equal(parsed.operations[0]!.action, 'update');
  assert.equal(
    receiptCorrectionSchema.safeParse({
      ...parsed,
      operations: [{ action: 'add', data: { ...data, quantity: 0 } }],
    }).success,
    false,
  );
  assert.equal(
    receiptCorrectionSchema.parse({ ...parsed, purchaseOrderNumber: ' 04821 ' })
      .purchaseOrderNumber,
    '04821',
  );
  assert.equal(
    receiptCorrectionSchema.safeParse({
      ...parsed,
      purchaseOrderNumber: 'PO-1',
    }).success,
    false,
  );
});
test('completion corrections use individually identified pieces and bound the total', () => {
  const item = {
    outcome: {
      stockItemId: id,
      expectedRevision: 2,
      outcome: 'consumed',
      scraps: [],
    },
    retainedPieces: [
      { id: randomUUID(), widthMm: 200, lengthMm: 1000, locationId: location },
    ],
  };
  const value = {
    reason: 'Correct offcut entry',
    expectedRevision: 2,
    items: [item],
    stockVersions: [{ stockItemId: id, expectedRevision: 2 }],
  };
  assert.ok(completionCorrectionSchema.safeParse(value).success);
  assert.equal(
    completionCorrectionSchema.safeParse({
      ...value,
      items: [
        {
          ...item,
          outcome: {
            ...item.outcome,
            scraps: [{ widthMm: 200, lengthMm: 1000, locationId: location }],
          },
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    completionCorrectionSchema.safeParse({
      ...value,
      items: [
        {
          ...item,
          retainedPieces: Array.from(
            { length: 1001 },
            () => item.retainedPieces[0],
          ),
        },
      ],
    }).success,
    false,
  );
});
test('reconstructing historical cutting uses its thickness, original tube and original width', () => {
  const outcome = stockCuttingOutcomeSchema.parse({
    stockItemId: id,
    expectedRevision: 9,
    outcome: 'returned-roll',
    radialDepthMm: 10,
    tubeOuterDiameterMm: 50,
    locationId: location,
  });
  const corrected = cuttingWrite(before, outcome, now, '0.500');
  assert.equal(corrected.measurementThicknessMm, '0.500');
  assert.equal(corrected.radialDepthMm, '10.000');
  assert.equal(corrected.initialLengthMm, '10000.000');
  assert.equal(corrected.consumedAt, null);
  assert.throws(
    () =>
      cuttingWrite(
        { ...before, isUsed: true, tubeOuterDiameterMm: 60 },
        outcome,
        now,
        '0.500',
      ),
    BadRequestException,
  );
  const remnant = {
    ...before,
    isRemnant: true,
    isUsed: true,
    explicitLengthMm: 1000,
  };
  const returned = stockCuttingOutcomeSchema.parse({
    stockItemId: id,
    expectedRevision: 1,
    outcome: 'returned-remnant',
    widthMm: 2200,
    explicitLengthMm: 900,
    locationId: location,
  });
  assert.throws(
    () => cuttingWrite(remnant, returned, now, null),
    BadRequestException,
  );
  assert.throws(
    () =>
      retainedPieceWrite(before, {
        widthMm: 2001,
        lengthMm: 100,
        locationId: location,
      }),
    BadRequestException,
  );
  assert.equal(
    retainedPieceWrite(before, {
      widthMm: 1000,
      lengthMm: 100,
      locationId: location,
    }).sourceStockItemId,
    id,
  );
});
test('audit snapshots strip unrelated data and keep complete measured state', () => {
  const result = auditChangeSchema.parse({
    recordType: 'stock-items',
    recordId: id,
    before: null,
    after: {
      type: 'stock-items',
      value: { ...before, email: 'private@example.com', requestHash: 'secret' },
    },
  });
  assert.ok(result.after);
  assert.equal('email' in result.after.value, false);
  assert.equal('requestHash' in result.after.value, false);
  assert.equal(result.after.type, 'stock-items');
});
test('correction replay is stable under object key order and rejects a changed payload', async () => {
  assert.equal(
    canonicalJson({ b: [1, 2], a: { c: 3 } }),
    canonicalJson({ a: { c: 3 }, b: [1, 2] }),
  );
  const result = {
    eventId: randomUUID(),
    recordId: id,
    revision: 3,
    affectedAllocationIds: [],
    createdStockItemIds: [],
  };
  let rows: unknown[] = [];
  const tx = {
    select: () => ({ from: () => ({ where: async () => rows }) }),
  } as unknown as DatabaseExecutor;
  const context = { audit: new AuditRepository(tx) } as UnitOfWorkContext;
  const repository = new AuditService(stubUnitOfWork(context));
  const input = {
    reason: 'Count',
    changes: { widthMm: 10 },
    expectedRevision: 2,
  };
  const first = await repository.replay(
    context,
    id,
    'stock.correct',
    id,
    id,
    input,
  );
  rows = [{ requestHash: first.requestHash, result }];
  assert.deepEqual(
    (
      await repository.replay(context, id, 'stock.correct', id, id, {
        expectedRevision: 2,
        changes: { widthMm: 10 },
        reason: 'Count',
      })
    ).result,
    result,
  );
  await assert.rejects(
    repository.replay(context, id, 'stock.correct', id, id, {
      ...input,
      reason: 'Different',
    }),
    ConflictException,
  );
});
test('legacy completion reports retain their timestamp token and original replay serialization', () => {
  const old = {
    expectedRevision: 2,
    items: [
      {
        stockItemId: id,
        expectedUpdatedAt: now.toISOString(),
        scraps: [],
        outcome: 'consumed',
        tubeOuterDiameterMm: 50,
      },
    ],
  };
  const parsed = completeAllocationRequestSchema.parse(old);
  assert.equal(JSON.stringify(parsed), JSON.stringify(old));
  assert.equal(completeAllocationSchema.safeParse(old).success, false);
  const report = allocationCompletionSchema.parse({
    submittedByUserId: id,
    items: old.items,
    createdStockItemIds: [],
    affectedAllocationIds: [],
  });
  assert.deepEqual(report.items, old.items);
  assert.equal('expectedRevision' in report.items[0]!, false);
});
