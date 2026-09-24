import { BadRequestException } from '@nestjs/common';
import {
  createStockReceiptSchema,
  stockReceiptDraftDataSchema,
} from '@roller-bay/shared/stock-receipts';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { stubUnitOfWork } from '../../testing/unit-of-work.js';
import { AuditService } from '../audit/index.js';
import type { StockItemsService } from '../stock-items/index.js';
import { StockReceiptDetailsService } from './stock-receipt-details.service.js';
import { StockReceiptConflictError } from './stock-receipts.errors.js';
import { stockReceiptsQuery } from './stock-receipts.persistence.js';
import {
  type StockReceiptItemRecord,
  type StockReceiptRecord,
} from './stock-receipts.repository.js';
import { StockReceiptsService } from './stock-receipts.service.js';

test('receipt drafts save incomplete lines without inventing dimensions or quantities', () => {
  const data = stockReceiptDraftDataSchema.parse({
    items: [{ widthMm: 1200.125 }, {}],
  });
  assert.equal(data.purchaseOrderNumber, null);
  assert.equal(data.items[0]!.widthMm, 1200.125);
  assert.equal(data.items[0]!.quantity, null);
  assert.equal(data.items[1]!.initialLengthMm, null);
  assert.deepEqual(stockReceiptDraftDataSchema.parse(data), data);
  assert.equal(createStockReceiptSchema.safeParse(data).success, false);
  for (const invalid of [
    { items: [{ widthMm: 1.0001 }] },
    { items: [{ quantity: 0 }] },
    { items: [{ locationId: 'missing' }] },
    { items: [{ initialLengthMm: -1 }] },
    { items: [{ quantity: 1000 }, { quantity: 1 }] },
    { items: Array.from({ length: 101 }, () => ({})) },
  ])
    assert.equal(stockReceiptDraftDataSchema.safeParse(invalid).success, false);
});

test('submitted receipts require a five-digit purchase-order number while drafts keep partial input', () => {
  const items = [
    {
      fabricColorId: randomUUID(),
      widthMm: 1200,
      initialLengthMm: 5000,
      locationId: randomUUID(),
    },
  ];
  assert.equal(
    createStockReceiptSchema.parse({ purchaseOrderNumber: ' 04821 ', items })
      .purchaseOrderNumber,
    '04821',
  );
  for (const purchaseOrderNumber of ['4821', '048210', 'PO-04821', '048 21'])
    assert.equal(
      createStockReceiptSchema.safeParse({ purchaseOrderNumber, items })
        .success,
      false,
    );
  assert.equal(
    stockReceiptDraftDataSchema.parse({ purchaseOrderNumber: 'PO-48' })
      .purchaseOrderNumber,
    'PO-48',
  );
});

test('receipt concurrent writes report conflicts rather than storage outages', async () => {
  for (const code of ['23505', '40001', '40P01', '55P03']) {
    await assert.rejects(
      stockReceiptsQuery(async () => {
        throw { cause: { code } };
      }),
      StockReceiptConflictError,
    );
  }
});

test('incomplete saved receipt submission never reaches stock creation or confirmation', async () => {
  const now = new Date();
  const header: StockReceiptRecord = {
    id: randomUUID(),
    purchaseOrderNumber: '10482',
    createdByUserId: randomUUID(),
    createdAt: now,
    updatedAt: now,
    isDraft: true,
    stockEffects: null,
    revision: 1,
    submittedDraftRevision: null,
    submittedAt: null,
    submittedByUserId: null,
    idempotencyKey: randomUUID(),
    requestHash: 'a'.repeat(64),
  };
  const lines: StockReceiptItemRecord[] = [
    {
      id: randomUUID(),
      stockReceiptId: header.id,
      position: 1,
      voidedAt: null,
      fabricColorId: randomUUID(),
      locationId: randomUUID(),
      widthMm: '1200.000',
      initialLengthMm: '5000.000',
      quantity: null,
    },
  ];
  let writes = 0;
  const repository = {
    findById: async () => header,
    findItems: async () => lines,
    update: async () => {
      writes++;
      return header;
    },
  };
  const stock = {
    receiveRolls: async () => {
      writes++;
    },
  };
  const service = new StockReceiptsService(
    stubUnitOfWork({ stockReceipts: repository }),
    {} as AuditService,
    stock as unknown as StockItemsService,
    new StockReceiptDetailsService(stock as unknown as StockItemsService),
  );
  await assert.rejects(
    service.submitDraft(header.id, 1, randomUUID()),
    BadRequestException,
  );
  assert.equal(writes, 0);
  assert.equal(header.submittedAt, null);
});
