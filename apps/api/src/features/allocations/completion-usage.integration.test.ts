import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { startCorrectionsApp } from '../../testing/corrections-app.js';

test(
  'correct actual fabric usage without changing the plan',
  { timeout: 60_000 },
  async (t) => {
    const {
      receipt,
      allocate,
      complete,
      completionContext,
      versions,
      post,
      get,
      readStock,
      pool,
      location,
    } = await startCorrectionsApp(t);
    const rolls = (await receipt(4)).items[0]!.stockItems;
    const [original, extra, reserved, later] = rolls;
    const { record, input, key } = await complete(await allocate(original!.id));
    const path = `/allocations/${record.id}/completion-corrections`;
    const outcome = (stock: (typeof rolls)[number], depth = 8) => ({
      stockItemId: stock.id,
      expectedRevision: stock.revision,
      outcome: 'returned-roll',
      radialDepthMm: depth,
      tubeOuterDiameterMm: 50,
      locationId: location.id,
      scraps: [],
    });
    await t.test(
      'add an unplanned roll, retain original completion and retry exactly',
      async () => {
        const c = await completionContext(record.id);
        const body = {
          expectedRevision: c.record.revision,
          reason: 'Another roll was used',
          additionalItems: [outcome(extra!)],
          stockVersions: versions(c),
        };
        const retryKey = randomUUID();
        const result = await post(path, body, retryKey).expect(200);
        assert.deepEqual(
          (await post(path, body, retryKey).expect(200)).body,
          result.body,
        );
        await post(
          path,
          { ...body, reason: 'Different reason' },
          retryKey,
        ).expect(409);
        const saved = (await get(`/allocations/${record.id}`).expect(200)).body;
        assert.deepEqual(saved.plan, record.plan);
        assert.equal(saved.completion.items.length, 2);
        assert.equal((await readStock(extra!.id)).radialDepthMm, 8);
        const raw = (
          await pool.query('SELECT completion FROM allocations WHERE id=$1', [
            record.id,
          ])
        ).rows[0].completion;
        assert.equal(raw.items.length, 1);
        await post(`/allocations/${record.id}/complete`, input, key).expect(
          200,
        );
      },
    );
    await t.test('an added roll can subsequently be corrected', async () => {
      const c = await completionContext(record.id);
      await post(path, {
        expectedRevision: c.record.revision,
        reason: 'Depth corrected',
        stockVersions: versions(c),
        items: [
          {
            outcome: outcome(await readStock(extra!.id), 7),
            retainedPieces: [],
            removeRetainedPieceIds: [],
          },
        ],
      }).expect(200);
      assert.equal((await readStock(extra!.id)).radialDepthMm, 7);
    });
    await t.test(
      'unused restores the baseline and voids only its retained pieces',
      async () => {
        const c = await completionContext(record.id);
        const pieces = c.effects.filter(
          (e) => !e.before && e.sourceStockItemId === original!.id,
        );
        await post(path, {
          expectedRevision: c.record.revision,
          reason: 'Planned roll was not used',
          unusedStockItemIds: [original!.id],
          stockVersions: versions(c),
        }).expect(200);
        const restored = await readStock(original!.id);
        assert.equal(restored.remainingLengthMm, original!.remainingLengthMm);
        assert.equal(restored.isUsed, original!.isUsed);
        assert.equal(restored.radialDepthMm, original!.radialDepthMm);
        for (const piece of pieces)
          assert.ok((await readStock(piece.stockItemId)).voidedAt);
        const saved = (await get(`/allocations/${record.id}`).expect(200)).body;
        assert.deepEqual(
          saved.completion.items.map(
            (i: { stockItemId: string }) => i.stockItemId,
          ),
          [extra!.id],
        );
        assert.deepEqual(saved.plan, record.plan);
      },
    );
    await t.test(
      'conflicts and later stock activity leave the whole correction unchanged',
      async () => {
        await allocate(reserved!.id);
        let c = await completionContext(record.id);
        const before = await readStock(extra!.id);
        await post(path, {
          expectedRevision: c.record.revision,
          reason: 'Conflicting added roll',
          unusedStockItemIds: [extra!.id],
          additionalItems: [outcome(reserved!)],
          stockVersions: versions(c),
        }).expect(409);
        assert.deepEqual(await readStock(extra!.id), before);
        await post(`/stock-items/${extra!.id}/corrections`, {
          expectedRevision: before.revision,
          reason: 'Later measurement',
          changes: { radialDepthMm: 6 },
        }).expect(200);
        c = await completionContext(record.id);
        await post(path, {
          expectedRevision: c.record.revision,
          reason: 'Cannot undo later use',
          unusedStockItemIds: [extra!.id],
          stockVersions: versions(c),
        }).expect(409);
        await post(path, {
          expectedRevision: c.record.revision,
          reason: 'Duplicate operations',
          unusedStockItemIds: [later!.id],
          additionalItems: [outcome(later!)],
          stockVersions: versions(c),
        }).expect(400);
        await post(path, {
          expectedRevision: c.record.revision,
          reason: 'Unknown original',
          unusedStockItemIds: [later!.id],
          stockVersions: versions(c),
        }).expect(400);
      },
    );
  },
);
