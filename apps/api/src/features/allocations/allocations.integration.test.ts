import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import {
  allocationDetailSchema,
  allocationListSchema,
} from '@roller-bay/shared/allocations';
import request from 'supertest';
import type { Environment } from '../../config/environment.js';
import { startAllocationsApp } from './testing/allocations-app.js';

test('allocations integration', { timeout: 60_000 }, async (t) => {
  const {
    app,
    server,
    path,
    cookie,
    origin,
    fixtures,
    get,
    post,
    put,
    seed,
    input,
    create,
    optimizedContexts,
  } = await startAllocationsApp(t);
  await t.test(
    'allocation routes require auth and origin checks, but normal users may operate the workflow',
    async () => {
      await request(server).get(path).expect(401);
      const body = await input(await seed());
      await request(server)
        .post(path)
        .set('Cookie', cookie)
        .send(body)
        .expect(403);
      await request(server)
        .post(path)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .send(body)
        .expect(400);
      const result = await create(body);
      assert.equal(result.state, 'active');
      assert.equal(result.revision, 1);
      assert.equal(result.items[0]!.stockItem.remainingLengthMm, 10000);
      assert.equal(result.items[0]!.reservedLengthMm, 1000);
      await request(server)
        .post(`/api/stock-items/${result.items[0]!.stockItemId}/corrections`)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .send({ widthMm: 1000 })
        .expect(403);
      await get(`${path}/${randomUUID()}`).expect(404);
    },
  );

  await t.test(
    'previews use authoritative snapshots, exclude own reservations, and do not write',
    async () => {
      const stockId = await seed(1000);
      const body = await input(stockId);
      const allocation = await create(body);
      const { workOrderId, plan } = body;
      const blocked = await post(`${path}/validate`, {
        workOrderId,
        plan,
      }).expect(200);
      assert.equal(blocked.body.valid, false);
      const valid = await post(`${path}/validate`, {
        workOrderId,
        plan,
        allocationId: allocation.id,
        expectedRevision: 1,
      }).expect(200);
      assert.equal(valid.body.valid, true);
      assert.equal(valid.body.stockItems[0].locationLabel, '1');
      await post(`${path}/validate`, {
        workOrderId,
        plan,
        stockItems: [],
      }).expect(400);
      await post(`${path}/optimize`, {
        workOrderId,
        allocationId: allocation.id,
        expectedRevision: 1,
      }).expect(200);
      assert.equal(
        optimizedContexts
          .at(-1)!
          .stockItems.find((item) => item.id === stockId)!.reservedLengthMm,
        0,
      );
      await post(`${path}/optimize`, {
        workOrderId,
        allocationId: allocation.id,
        expectedRevision: 999,
      }).expect(409);
      const after = await get(`${path}/${allocation.id}`).expect(200);
      assert.equal(after.body.revision, 1);
      assert.equal(after.body.items[0].stockItem.remainingLengthMm, 1000);
    },
  );

  await t.test(
    'configured rules are server-owned and saved across previews, draft submission, edits, and retries',
    async () => {
      const config = app.get<ConfigService<Environment, true>>(ConfigService);
      const original = {
        CUTTING_EDGE_TRIM_MM: config.getOrThrow('CUTTING_EDGE_TRIM_MM', {
          infer: true,
        }),
        CUTTING_MINIMUM_REMNANT_WIDTH_MM: config.getOrThrow(
          'CUTTING_MINIMUM_REMNANT_WIDTH_MM',
          { infer: true },
        ),
        CUTTING_MINIMUM_REMNANT_LENGTH_MM: config.getOrThrow(
          'CUTTING_MINIMUM_REMNANT_LENGTH_MM',
          { infer: true },
        ),
        CUTTING_DROP_ALLOWANCE_MM: config.getOrThrow(
          'CUTTING_DROP_ALLOWANCE_MM',
          { infer: true },
        ),
      };
      try {
        config.set('CUTTING_EDGE_TRIM_MM', 25.4);
        config.set('CUTTING_MINIMUM_REMNANT_WIDTH_MM', 1524);
        config.set('CUTTING_MINIMUM_REMNANT_LENGTH_MM', 1524);
        config.set('CUTTING_DROP_ALLOWANCE_MM', 254);
        const body = await input(await seed());
        const { workOrderId } = body;
        // Cut length is derived from the drop and allowance, never supplied.
        await post(`${path}/validate`, {
          workOrderId,
          plan: { cuts: [{ ...body.plan.cuts[0], lengthMm: 1254 }] },
        }).expect(400);
        const preview = await post(`${path}/validate`, {
          workOrderId,
          plan: body.plan,
        }).expect(200);
        assert.equal(preview.body.valid, true);
        await post(`${path}/optimize`, { workOrderId }).expect(200);
        assert.equal(
          optimizedContexts.at(-1)!.requirements[0]!.lengthAllowanceMm,
          254,
        );
        assert.deepEqual(optimizedContexts.at(-1)!.settings, {
          edgeTrimMm: 25.4,
          minimumRemnantWidthMm: 1524,
          minimumRemnantLengthMm: 1524,
        });
        const key = randomUUID();
        const created = await create(body, key);
        assert.equal(created.requirements[0]!.lengthAllowanceMm, 254);
        assert.equal(created.plan.cuts[0]!.lengthMm, 1254);
        assert.equal(created.items[0]!.reservedLengthMm, 1254);
        assert.deepEqual(created.plannedSummary, preview.body.summary);
        assert.deepEqual(created.settings, {
          edgeTrimMm: 25.4,
          minimumRemnantWidthMm: 1524,
          minimumRemnantLengthMm: 1524,
          dropAllowanceMm: 254,
        });
        const draftBody = await input(body.plan.cuts[0]!.stockItemId);
        const draftKey = randomUUID();
        const draft = (
          await post(`${path}/drafts`, { data: draftBody }, draftKey).expect(
            201,
          )
        ).body;
        config.set('CUTTING_EDGE_TRIM_MM', 400);
        config.set('CUTTING_DROP_ALLOWANCE_MM', 508);
        assert.deepEqual(await create(body, key), created);
        assert.deepEqual(
          (
            await post(`${path}/drafts`, { data: draftBody }, draftKey).expect(
              201,
            )
          ).body,
          draft,
        );
        for (const [id, data] of [
          [created.id, body],
          [draft.id, draftBody],
        ] as const) {
          const result = await post(`${path}/validate`, {
            workOrderId: data.workOrderId,
            plan: data.plan,
            allocationId: id,
            expectedRevision: 1,
          }).expect(200);
          assert.equal(result.body.valid, true);
        }
        const current = await post(`${path}/validate`, {
          workOrderId,
          plan: body.plan,
        }).expect(200);
        assert.equal(current.body.valid, false);
        await request(server)
          .put(`${path}/${draft.id}/draft`)
          .set('Cookie', cookie)
          .set('Origin', origin)
          .send({ expectedRevision: 1, data: draftBody })
          .expect(200);
        const submitted = (
          await post(`${path}/${draft.id}/submit`, {
            expectedRevision: 2,
          }).expect(200)
        ).body;
        assert.deepEqual(submitted.settings, created.settings);
        assert.equal(submitted.requirements[0].lengthAllowanceMm, 254);
        const replaced = (
          await put(created.id, {
            plan: body.plan,
            expectedRevision: 1,
          }).expect(200)
        ).body;
        assert.deepEqual(replaced.settings, created.settings);
        assert.equal(replaced.items[0].reservedLengthMm, 1254);
        // Rules and blinds are the server's and the order's, never the request's.
        for (const extra of [
          { ...body, settings: created.settings },
          { ...body, requirements: created.requirements },
        ]) {
          await post(path, extra).expect(400);
          await post(`${path}/drafts`, { data: extra }).expect(400);
        }
      } finally {
        for (const [key, value] of Object.entries(original))
          config.set(key as keyof typeof original, value);
      }
    },
  );

  await t.test(
    'creation retries are durable and competing orders cannot over-reserve a roll',
    async () => {
      const body = await input(await seed());
      const key: string = randomUUID();
      const replies = await Promise.all([
        post(path, body, key),
        post(path, body, key),
      ]);
      assert.deepEqual(
        replies.map((reply) => reply.status),
        [201, 201],
      );
      assert.equal(replies[0]!.body.id, replies[1]!.body.id);
      // The key is bound to its first request.
      await post(
        path,
        { ...body, workOrderId: (await input(await seed())).workOrderId },
        key,
      ).expect(409);
      const stock = await seed(1500);
      const competing = await Promise.all([
        post(path, await input(stock)),
        post(path, await input(stock)),
      ]);
      assert.deepEqual(
        competing.map((reply) => reply.status).sort(),
        [201, 409],
      );
      const missing = await input(randomUUID());
      await post(path, missing).expect(404);
      const { order_number } = await fixtures.workOrder(missing.workOrderId);
      const list = allocationListSchema.parse(
        (await get(`${path}?search=${order_number}`).expect(200)).body,
      );
      assert.equal(list.total, 0);
      // A refused allocation claims nothing.
      assert.equal(
        (await fixtures.workOrder(missing.workOrderId)).allocated_at,
        null,
      );
    },
  );

  await t.test(
    'replacement locks both released and selected stock, checks revisions, and cancellation releases reservations',
    async () => {
      const stockId = await seed(1000);
      const body = await input(stockId);
      const allocation = await create(body);
      // A replan is the same order's blinds cut from other stock.
      const replan = (stock: string, expectedRevision: number) => ({
        plan: { cuts: [{ ...body.plan.cuts[0]!, stockItemId: stock }] },
        expectedRevision,
      });
      const edited = replan(await seed(1000), 1);
      const replies = await Promise.all([
        put(allocation.id, edited),
        put(allocation.id, edited),
      ]);
      assert.deepEqual(replies.map((reply) => reply.status).sort(), [200, 409]);
      await post(`${path}/${allocation.id}/cancel`, {
        expectedRevision: 1,
      }).expect(409);
      const cancelled = await post(`${path}/${allocation.id}/cancel`, {
        expectedRevision: 2,
      }).expect(200);
      assert.equal(cancelled.body.state, 'cancelled');
      assert.equal(cancelled.body.revision, 3);
      await post(`${path}/${allocation.id}/cancel`, {
        expectedRevision: 2,
      }).expect(200);
      await put(allocation.id, replan(stockId, 3)).expect(409);
      // An allocation stays with its order.
      await put(allocation.id, { ...body, expectedRevision: 3 }).expect(400);
      await create(await input(stockId));
      const list = allocationListSchema.parse(
        (
          await get(
            `${path}?search=${allocation.orderNumber}&state=cancelled&pageSize=1`,
          ).expect(200)
        ).body,
      );
      assert.equal(list.items[0]!.id, allocation.id);
      assert.equal(list.items[0]!.needsReplanning, false);
    },
  );

  await t.test(
    'failed replacement preserves the old plan and reservations',
    async () => {
      const original = await input(await seed(1000));
      const allocation = await create(original);
      const unavailable = await seed(1000);
      await create(await input(unavailable));
      await put(allocation.id, {
        plan: {
          cuts: [{ ...original.plan.cuts[0]!, stockItemId: unavailable }],
        },
        expectedRevision: 1,
      }).expect(409);
      const unchanged = allocationDetailSchema.parse(
        (await get(`${path}/${allocation.id}`).expect(200)).body,
      );
      assert.equal(unchanged.revision, 1);
      assert.equal(
        unchanged.items[0]!.stockItemId,
        original.plan.cuts[0]!.stockItemId,
      );
    },
  );
});
