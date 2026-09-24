import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { AuditService } from '../audit/index.js';
import { startAllocationsApp } from './testing/allocations-app.js';

test(
  'initial cutting results record actual stock usage',
  { timeout: 60_000 },
  async (t) => {
    const { app, pool, ids, get, post, seed, input, create, path } =
      await startAllocationsApp(t);
    const outcome = (stockItemId: string, expectedRevision = 1) => ({
      stockItemId,
      expectedRevision,
      outcome: 'consumed',
      tubeOuterDiameterMm: 50,
      scraps: [],
    });
    await t.test(
      'substitutes additional fabric, releases unused fabric unchanged, and replays once',
      async () => {
        const original = await seed();
        const extra = await seed();
        const record = await create(await input(original));
        const originalBefore = (
          await get(`/api/stock-items/${original}`).expect(200)
        ).body;
        const extraBefore = (await get(`/api/stock-items/${extra}`).expect(200))
          .body;
        const body = {
          expectedRevision: record.revision,
          unusedStockItemIds: [original],
          items: [outcome(extra, extraBefore.revision)],
        };
        const key = randomUUID();
        const result = (
          await post(`${path}/${record.id}/complete`, body, key).expect(200)
        ).body;
        assert.equal(result.state, 'completed');
        assert.deepEqual(result.plan, record.plan);
        assert.deepEqual(result.completion.unusedStockItemIds, [original]);
        assert.deepEqual(
          result.completion.items.map(
            (i: { stockItemId: string }) => i.stockItemId,
          ),
          [extra],
        );
        assert.deepEqual(
          (await get(`/api/stock-items/${original}`).expect(200)).body,
          originalBefore,
        );
        assert.ok(
          (await get(`/api/stock-items/${extra}`).expect(200)).body.consumedAt,
        );
        const replay = await post(
          `${path}/${record.id}/complete`,
          body,
          key,
        ).expect(200);
        assert.deepEqual(replay.body.completion, result.completion);
        assert.equal(
          (await get(`/api/stock-items/${extra}`).expect(200)).body.revision,
          extraBefore.revision + 1,
        );
        await post(
          `${path}/${record.id}/complete`,
          { ...body, unusedStockItemIds: [] },
          key,
        ).expect(409);
        // The unchanged original roll is available for a new order.
        await create(await input(original, 9000));
        const audit = await pool.query(
          'SELECT completion, stock_effects FROM allocations WHERE id=$1',
          [record.id],
        );
        assert.equal(audit.rows[0].stock_effects.length, 1);
        assert.equal(audit.rows[0].stock_effects[0].stockItemId, extra);
      },
    );
    await t.test(
      'requires explicit planned coverage and rejects overlapping or duplicate IDs',
      async () => {
        const original = await seed();
        const extra = await seed();
        const record = await create(await input(original));
        const url = `${path}/${record.id}/complete`;
        await post(url, {
          expectedRevision: 1,
          items: [outcome(extra)],
        }).expect(400);
        await post(url, {
          expectedRevision: 1,
          items: [outcome(original)],
          unusedStockItemIds: [original],
        }).expect(400);
        await post(url, {
          expectedRevision: 1,
          items: [outcome(original), outcome(original)],
        }).expect(400);
        await post(url, {
          expectedRevision: 1,
          items: [outcome(original)],
          unusedStockItemIds: [extra],
        }).expect(400);
        assert.equal(
          (await get(`${path}/${record.id}`).expect(200)).body.state,
          'active',
        );
      },
    );
    await t.test(
      'checks additional fabric color, reservations, and stock revisions',
      async () => {
        const original = await seed();
        const extra = await seed();
        const record = await create(await input(original));
        const body = {
          expectedRevision: 1,
          unusedStockItemIds: [original],
          items: [outcome(extra, 99)],
        };
        const url = `${path}/${record.id}/complete`;
        await post(url, body).expect(409);
        const otherColor = randomUUID();
        await pool.query(
          "INSERT INTO fabric_colors (id,material_id,code,thickness_mm) VALUES ($1,$2,'DIFFERENT',0.5)",
          [otherColor, ids.material],
        );
        await pool.query(
          'UPDATE fabric_stock_items SET fabric_color_id=$1 WHERE id=$2',
          [otherColor, extra],
        );
        await post(url, { ...body, items: [outcome(extra)] }).expect(400);
        const reserved = await seed();
        await create(await input(reserved));
        await post(url, { ...body, items: [outcome(reserved)] }).expect(409);
        assert.equal(
          (await get(`/api/stock-items/${original}`).expect(200)).body.isUsed,
          false,
        );
      },
    );
    await t.test(
      'concurrent submissions cannot both consume the same additional roll',
      async () => {
        const extra = await seed();
        const firstStock = await seed();
        const secondStock = await seed();
        const first = await create(await input(firstStock));
        const second = await create(await input(secondStock));
        const replies = await Promise.all([
          post(`${path}/${first.id}/complete`, {
            expectedRevision: 1,
            unusedStockItemIds: [firstStock],
            items: [outcome(extra)],
          }),
          post(`${path}/${second.id}/complete`, {
            expectedRevision: 1,
            unusedStockItemIds: [secondStock],
            items: [outcome(extra)],
          }),
        ]);
        assert.deepEqual(replies.map((r) => r.status).sort(), [200, 409]);
        assert.equal(
          (await get(`/api/stock-items/${extra}`).expect(200)).body.revision,
          2,
        );
      },
    );
    await t.test(
      'rolls back additional usage and reservation release if auditing fails',
      async () => {
        const original = await seed();
        const extra = await seed();
        const record = await create(await input(original));
        const before = (await get(`/api/stock-items/${extra}`).expect(200))
          .body;
        const audit = app.get(AuditService);
        const recordAudit = audit.record.bind(audit);
        audit.record = async () => {
          throw new Error('injected audit failure');
        };
        try {
          await post(`${path}/${record.id}/complete`, {
            expectedRevision: 1,
            unusedStockItemIds: [original],
            items: [outcome(extra)],
          }).expect(503);
        } finally {
          audit.record = recordAudit;
        }
        assert.deepEqual(
          (await get(`/api/stock-items/${extra}`).expect(200)).body,
          before,
        );
        assert.equal(
          (await get(`${path}/${record.id}`).expect(200)).body.state,
          'active',
        );
      },
    );
  },
);
