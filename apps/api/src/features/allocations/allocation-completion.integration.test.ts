import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { allocationDetailSchema } from '@roller-bay/shared/allocations';
import { StockItemsRepository } from '../stock-items/stock-items.repository.js';
import { startAllocationsApp } from './testing/allocations-app.js';

test('allocation completion integration', { timeout: 60_000 }, async (t) => {
  const { path, ids, get, post, put, seed, input, create, countStock } =
    await startAllocationsApp(t);
  await t.test(
    'completion records measurements, creates scraps once, and flags other allocations for replanning',
    async () => {
      const stockId = await seed(2000);
      const first = await create(input(stockId, 1000));
      const secondInput = input(stockId, 700);
      const second = await create(secondInput);
      const key: string = randomUUID();
      const body = {
        expectedRevision: 1,
        items: [
          {
            stockItemId: stockId,
            expectedRevision: first.items[0]!.stockItem.revision,
            outcome: 'returned-roll',
            radialDepthMm: 1,
            tubeOuterDiameterMm: 50,
            locationId: ids.location,
            scraps: [
              {
                widthMm: 100,
                lengthMm: 100,
                locationId: ids.location,
                quantity: 2,
              },
            ],
          },
        ],
      };
      const before = await countStock();
      const replies = await Promise.all([
        post(`${path}/${first.id}/complete`, body, key),
        post(`${path}/${first.id}/complete`, body, key),
      ]);
      assert.deepEqual(
        replies.map((reply) => reply.status),
        [200, 200],
      );
      const completed = allocationDetailSchema.parse(replies[0]!.body);
      assert.equal(completed.state, 'completed');
      assert.equal(completed.revision, 2);
      assert.equal(completed.items[0]!.stockItem.remainingLengthMm, 320.442);
      assert.equal(completed.items[0]!.stockItem.isUsed, true);
      assert.equal(completed.items[0]!.stockItem.measurementThicknessMm, 0.5);
      assert.equal(await countStock(), before + 2);
      assert.deepEqual(
        replies[0]!.body.completion.createdStockItemIds,
        replies[1]!.body.completion.createdStockItemIds,
      );
      assert.ok(
        completed.completion!.affectedAllocationIds.includes(second.id),
      );
      for (const id of completed.completion!.createdStockItemIds) {
        const scrap = (await get(`/api/stock-items/${id}`).expect(200)).body;
        assert.equal(scrap.sourceStockItemId, stockId);
        assert.equal(scrap.isRemnant, true);
        assert.equal(scrap.tubeOuterDiameterMm, null);
      }
      assert.equal(
        (await get(`${path}/${second.id}`).expect(200)).body.needsReplanning,
        true,
      );
      const list = (
        await get(`${path}?search=${second.orderNumber}`).expect(200)
      ).body;
      assert.equal(list.items[0].needsReplanning, true);
      await post(
        `${path}/${first.id}/complete`,
        { ...body, expectedRevision: 2 },
        key,
      ).expect(409);
      await post(`${path}/${first.id}/complete`, body).expect(409);
      await put(first.id, { ...input(stockId), expectedRevision: 2 }).expect(
        409,
      );
      const replacement = {
        ...secondInput,
        plan: {
          cuts: [{ ...secondInput.plan.cuts[0]!, stockItemId: await seed() }],
        },
        expectedRevision: 1,
      };
      assert.equal(
        (await put(second.id, replacement).expect(200)).body.needsReplanning,
        false,
      );
    },
  );

  await t.test(
    'completion rolls back all stock writes and scraps on invalid references, then allows retry',
    async () => {
      const stockId = await seed();
      const allocation = await create(input(stockId));
      const body = {
        expectedRevision: 1,
        items: [
          {
            stockItemId: stockId,
            expectedRevision: allocation.items[0]!.stockItem.revision,
            outcome: 'returned-roll',
            radialDepthMm: 1,
            tubeOuterDiameterMm: 50,
            locationId: ids.location,
            scraps: [
              {
                widthMm: 100,
                lengthMm: 100,
                quantity: 1,
                locationId: randomUUID(),
              },
            ],
          },
        ],
      };
      const before = await countStock();
      const key: string = randomUUID();
      await post(`${path}/${allocation.id}/complete`, body, key).expect(404);
      assert.equal(await countStock(), before);
      const unchanged = allocationDetailSchema.parse(
        (await get(`${path}/${allocation.id}`).expect(200)).body,
      );
      assert.equal(unchanged.state, 'active');
      assert.equal(unchanged.items[0]!.stockItem.remainingLengthMm, 10000);
      body.items[0]!.scraps[0]!.locationId = ids.location;
      await post(`${path}/${allocation.id}/complete`, body, key).expect(200);
    },
  );

  await t.test(
    'completion enforces stock revisions, tube rules, outcome coverage and retained-remnant dimensions',
    async () => {
      const stockId = await seed();
      const allocation = await create(input(stockId));
      const consumed = {
        stockItemId: stockId,
        outcome: 'consumed',
        expectedRevision: allocation.items[0]!.stockItem.revision,
      };
      await post(`${path}/${allocation.id}/complete`, {
        expectedRevision: 1,
        items: [],
      }).expect(400);
      await post(`${path}/${allocation.id}/complete`, {
        expectedRevision: 1,
        items: [consumed, consumed],
      }).expect(400);
      await post(`${path}/${allocation.id}/complete`, {
        expectedRevision: 1,
        items: [consumed],
      }).expect(400);
      await post(`${path}/${allocation.id}/complete`, {
        expectedRevision: 1,
        items: [{ ...consumed, tubeOuterDiameterMm: 50.0005 }],
      }).expect(400);
      await post(`${path}/${allocation.id}/complete`, {
        expectedRevision: 1,
        items: [
          {
            ...consumed,
            tubeOuterDiameterMm: 50,
            expectedRevision: 999,
          },
        ],
      }).expect(409);
      const complete = await post(`${path}/${allocation.id}/complete`, {
        expectedRevision: 1,
        items: [{ ...consumed, tubeOuterDiameterMm: 50 }],
      }).expect(200);
      assert.equal(complete.body.items[0].stockItem.remainingLengthMm, 0);
      const remnantId = await seed(1000, true);
      const remnant = await create(input(remnantId, 400));
      assert.equal(remnant.items[0]!.reservedLengthMm, 1000);
      const result = await post(`${path}/${remnant.id}/complete`, {
        expectedRevision: 1,
        items: [
          {
            stockItemId: remnantId,
            expectedRevision: remnant.items[0]!.stockItem.revision,
            outcome: 'returned-remnant',
            widthMm: 600,
            explicitLengthMm: 500,
            locationId: ids.location,
          },
        ],
      }).expect(200);
      assert.equal(result.body.items[0].stockItem.widthMm, 600);
      assert.equal(result.body.items[0].stockItem.remainingLengthMm, 500);
    },
  );

  await t.test(
    'a failure after writing stock leaves the allocation active and retryable',
    async () => {
      const stockId = await seed();
      const allocation = await create(input(stockId));
      const prototype = StockItemsRepository.prototype;
      const createFailure = t.mock.method(prototype, 'create', async () => {
        throw new Error('Injected failure');
      });
      const body = {
        expectedRevision: 1,
        items: [
          {
            stockItemId: stockId,
            expectedRevision: allocation.items[0]!.stockItem.revision,
            outcome: 'consumed',
            tubeOuterDiameterMm: 50,
            scraps: [{ widthMm: 100, lengthMm: 100, locationId: ids.location }],
          },
        ],
      };
      try {
        await post(`${path}/${allocation.id}/complete`, body).expect(503);
      } finally {
        createFailure.mock.restore();
      }
      const unchanged = (await get(`${path}/${allocation.id}`).expect(200))
        .body;
      assert.equal(unchanged.state, 'active');
      assert.equal(unchanged.items[0].stockItem.consumedAt, null);
    },
  );
});
