import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { historySchema } from '@roller-bay/shared/audit';
import { correctionResultSchema } from '@roller-bay/shared/corrections';
import { stockReceiptDetailSchema } from '@roller-bay/shared/stock-receipts';
import { AuditRepository } from '../audit/testing/index.js';
import { startCorrectionsApp } from '../../testing/corrections-app.js';

test('receipt corrections integration', { timeout: 60_000 }, async (t) => {
  const {
    pool,
    get,
    post,
    otherColor,
    line,
    receipt,
    readStock,
    receiptContext,
    versions,
    allocate,
  } = await startCorrectionsApp(t);
  await t.test(
    'receipt quantity corrections preserve identities, original submission and immutable history across retries',
    async () => {
      const r = await receipt(3),
        context = await receiptContext(r.id),
        lineId = r.items[0]!.id;
      const removed = r.items[0]!.stockItemIds[0]!;
      const originalHistory = (
        await get(`/stock-receipts/${r.id}/history`).expect(200)
      ).body;
      const body = {
        reason: 'Only two rolls arrived',
        expectedRevision: r.revision,
        operations: [
          {
            action: 'update',
            lineId,
            data: line,
            removeStockItemIds: [removed],
          },
        ],
        stockVersions: versions(context),
      };
      const key = randomUUID();
      const responses = await Promise.all([
        post(`/stock-receipts/${r.id}/corrections`, body, key),
        post(`/stock-receipts/${r.id}/corrections`, body, key),
      ]);
      assert.deepEqual(
        responses.map((r) => r.status),
        [200, 200],
      );
      assert.deepEqual(responses[0]!.body, responses[1]!.body);
      correctionResultSchema.parse(responses[0]!.body);
      await post(
        `/stock-receipts/${r.id}/corrections`,
        { ...body, reason: 'Changed' },
        key,
      ).expect(409);
      const corrected = stockReceiptDetailSchema.parse(
        (await get(`/stock-receipts/${r.id}`).expect(200)).body,
      );
      assert.equal(corrected.submittedAt, r.submittedAt);
      assert.equal(corrected.submittedByUserId, r.submittedByUserId);
      assert.equal(corrected.items[0]!.id, lineId);
      assert.deepEqual(
        corrected.items[0]!.stockItemIds,
        r.items[0]!.stockItemIds,
      );
      const voided = await readStock(removed);
      assert.ok(voided.voidedAt);
      assert.equal(voided.consumedAt, null);
      assert.equal(voided.remainingLengthMm, 0);
      assert.ok(
        !(await get('/stock-items').expect(200)).body.items.some(
          (i: { id: string }) => i.id === removed,
        ),
      );
      assert.ok(
        (await get('/stock-items?isVoided=true').expect(200)).body.items.some(
          (i: { id: string }) => i.id === removed,
        ),
      );
      const history = historySchema.parse(
        (await get(`/stock-receipts/${r.id}/history`).expect(200)).body,
      );
      assert.equal(history.total, 2);
      assert.deepEqual(
        history.items.find((e) => e.id === originalHistory.items[0].id),
        originalHistory.items[0],
      );
      const next = await receiptContext(r.id);
      const added = correctionResultSchema.parse(
        (
          await post(`/stock-receipts/${r.id}/corrections`, {
            ...body,
            expectedRevision: next.record.revision,
            operations: [
              {
                action: 'update',
                lineId,
                data: { ...line, quantity: 4 },
                removeStockItemIds: [],
              },
            ],
            stockVersions: versions(next),
          }).expect(200)
        ).body,
      );
      assert.equal(added.createdStockItemIds.length, 2);
      await post(`/stock-receipts/${r.id}/corrections`, body, key).expect(200);
    },
  );
  await t.test(
    'receipt lines with later activity block independently; unused lines can change fabric and dimensions',
    async () => {
      const r = stockReceiptDetailSchema.parse(
        (
          await post('/stock-receipts', {
            purchaseOrderNumber: '30002',
            items: [line, line],
          }).expect(201)
        ).body,
      );
      const first = r.items[0]!,
        second = r.items[1]!;
      const allocation = await allocate(first.stockItemIds[0]!);
      const context = await receiptContext(r.id);
      const body = {
        reason: 'Wrong fabric on second line',
        expectedRevision: r.revision,
        stockVersions: versions(context),
        operations: [
          {
            action: 'update',
            lineId: second.id,
            data: {
              ...line,
              fabricColorId: otherColor.id,
              widthMm: 1800,
              initialLengthMm: 8000,
            },
          },
        ],
      };
      await post(`/stock-receipts/${r.id}/corrections`, body).expect(200);
      assert.equal(
        (await readStock(second.stockItemIds[0]!)).fabricColorId,
        otherColor.id,
      );
      const next = await receiptContext(r.id);
      await post(`/stock-receipts/${r.id}/corrections`, {
        ...body,
        expectedRevision: next.record.revision,
        stockVersions: versions(next),
        operations: [{ action: 'remove', lineId: first.id }],
      }).expect(409);
      await post(`/allocations/${allocation.id}/cancel`, {
        expectedRevision: allocation.revision,
      }).expect(200);
      const s = await readStock(first.stockItemIds[0]!);
      await post(`/stock-items/${s.id}/corrections`, {
        reason: 'Current stock adjustment',
        expectedRevision: s.revision,
        changes: { widthMm: 1900 },
      }).expect(200);
      assert.ok(
        (await receiptContext(r.id)).eligibility
          .find((e) => e.stockItemId === s.id)!
          .blockers.some((b) => b.code === 'changed'),
      );
    },
  );
  await t.test(
    'legacy receipt stock stays untouched while paperwork references remain correctable',
    async () => {
      const r = await receipt(1);
      await pool.query(
        `UPDATE stock_receipts SET stock_effects=NULL WHERE id=$1`,
        [r.id],
      );
      const c = await receiptContext(r.id);
      assert.equal(c.baselineAvailable, false);
      await post(`/stock-receipts/${r.id}/corrections`, {
        reason: 'Paperwork typo',
        expectedRevision: r.revision,
        purchaseOrderNumber: '30003',
      }).expect(200);
      await post(`/stock-receipts/${r.id}/corrections`, {
        reason: 'Old stock correction',
        expectedRevision: r.revision + 1,
        operations: [{ action: 'remove', lineId: r.items[0]!.id }],
      }).expect(409);
      assert.equal((await readStock(r.items[0]!.stockItemIds[0]!)).revision, 1);
    },
  );
  await t.test(
    'audit insertion failure rolls back correction, stock and retry claim',
    async (t) => {
      const r = await receipt(1),
        c = await receiptContext(r.id),
        id = r.items[0]!.stockItemIds[0]!;
      const body = {
        reason: 'Rollback proof',
        expectedRevision: r.revision,
        operations: [
          {
            action: 'update',
            lineId: r.items[0]!.id,
            data: { ...line, quantity: 3 },
          },
        ],
        stockVersions: versions(c),
      };
      const key = randomUUID();
      const fail = t.mock.method(
        AuditRepository.prototype,
        'insertEvent',
        async () => {
          throw new Error('Simulated audit storage failure');
        },
      );
      await post(`/stock-receipts/${r.id}/corrections`, body, key).expect(503);
      fail.mock.restore();
      assert.equal((await readStock(id)).revision, 1);
      assert.equal(
        (await get(`/stock-receipts/${r.id}`).expect(200)).body.items[0]
          .stockItemIds.length,
        1,
      );
      const result = correctionResultSchema.parse(
        (
          await post(`/stock-receipts/${r.id}/corrections`, body, key).expect(
            200,
          )
        ).body,
      );
      assert.equal(result.createdStockItemIds.length, 2);
    },
  );
  await t.test(
    'mixed receipt operations roll back together and removed lines retain original values',
    async () => {
      const r = stockReceiptDetailSchema.parse(
        (
          await post('/stock-receipts', {
            purchaseOrderNumber: '30004',
            items: [line, line],
          }).expect(201)
        ).body,
      );
      const reserved = await allocate(r.items[0]!.stockItemIds[0]!);
      const context = await receiptContext(r.id);
      await post(`/stock-receipts/${r.id}/corrections`, {
        reason: 'Correct both entries',
        expectedRevision: r.revision,
        stockVersions: versions(context),
        operations: [
          {
            action: 'update',
            lineId: r.items[1]!.id,
            data: { ...line, widthMm: 1800 },
          },
          { action: 'remove', lineId: r.items[0]!.id },
        ],
      }).expect(409);
      assert.equal(
        (await readStock(r.items[1]!.stockItemIds[0]!)).widthMm,
        line.widthMm,
      );
      assert.equal(
        (await get(`/stock-receipts/${r.id}`).expect(200)).body.revision,
        r.revision,
      );
      await post(`/allocations/${reserved.id}/cancel`, {
        expectedRevision: reserved.revision,
      }).expect(200);
      await post(`/stock-receipts/${r.id}/corrections`, {
        reason: 'Line entered by mistake',
        expectedRevision: r.revision,
        stockVersions: versions(context),
        operations: [{ action: 'remove', lineId: r.items[0]!.id }],
      }).expect(200);
      const saved = stockReceiptDetailSchema.parse(
        (await get(`/stock-receipts/${r.id}`).expect(200)).body,
      );
      assert.ok(saved.items[0]!.voidedAt);
      assert.equal(saved.items[0]!.quantity, r.items[0]!.quantity);
      assert.deepEqual(saved.items[0]!.stockItemIds, r.items[0]!.stockItemIds);
      assert.equal(saved.items[1]!.voidedAt, null);
    },
  );
});
