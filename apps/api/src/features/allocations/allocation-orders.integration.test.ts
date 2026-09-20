import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { historySchema } from '@roller-bay/shared/audit';
import { allocationDetailSchema } from '@roller-bay/shared/allocations';
import request from 'supertest';
import { startAllocationsApp } from './testing/allocations-app.js';

test('allocation orders integration', { timeout: 60_000 }, async (t) => {
  const {
    server,
    path,
    cookie,
    userId,
    origin,
    pool,
    fixtures,
    get,
    post,
    put,
    seed,
    input,
    create,
  } = await startAllocationsApp(t);
  await t.test(
    'allocations name a scheduled order, and an order has one live allocation',
    async () => {
      const unscheduled = { ...input(await seed()), orderNumber: '888888' };
      const issue = (body: { issues?: { code: string; path: unknown }[] }) =>
        body.issues?.map(({ code, path }) => ({ code, path }));
      const missing = [{ code: 'order_not_scheduled', path: ['orderNumber'] }];
      assert.deepEqual(
        issue((await post(path, unscheduled).expect(404)).body),
        missing,
      );
      assert.deepEqual(
        issue(
          (
            await post(`${path}/drafts`, {
              data: { orderNumber: '888888' },
            }).expect(404)
          ).body,
        ),
        missing,
      );
      // Partial order numbers are no longer saved on drafts.
      await post(`${path}/drafts`, { data: { orderNumber: '8888' } }).expect(
        400,
      );

      const first = await create(input(await seed()));
      const again = {
        ...input(await seed()),
        orderNumber: first.orderNumber,
      };
      const taken = [
        { code: 'order_already_allocated', path: ['orderNumber'] },
      ];
      assert.deepEqual(
        issue((await post(path, again).expect(409)).body),
        taken,
      );
      const other = await create(input(await seed()));
      assert.deepEqual(
        issue(
          (
            await put(other.id, {
              ...again,
              expectedRevision: other.revision,
            }).expect(409)
          ).body,
        ),
        taken,
      );
      await put(other.id, {
        ...unscheduled,
        expectedRevision: other.revision,
      }).expect(404);

      // An allocation's blinds add up to its order's quantity, when it is
      // confirmed and again when it is replanned.
      const counted = input(await seed());
      const setQuantity = (quantity: number) =>
        fixtures.setOrderQuantity(counted.orderNumber, quantity);
      await setQuantity(3);
      const short = await post(path, counted).expect(400);
      assert.deepEqual(issue(short.body), [
        { code: 'order_quantity_mismatch', path: ['orderNumber'] },
      ]);
      assert.equal(
        short.body.message,
        'The order has 3 blinds but the allocation has 1.',
      );
      // The refused allocation claimed nothing.
      assert.equal(
        (await fixtures.scheduledOrder(counted.orderNumber)).allocated_at,
        null,
      );
      await setQuantity(1);
      const matched = await create(counted);
      await setQuantity(2);
      assert.deepEqual(
        issue(
          (
            await put(matched.id, {
              ...counted,
              expectedRevision: matched.revision,
            }).expect(400)
          ).body,
        ),
        [{ code: 'order_quantity_mismatch', path: ['orderNumber'] }],
      );
      await setQuantity(1);

      // Drafts claim nothing, so they may share the order's number.
      const drafts = [];
      for (let count = 0; count < 2; count++)
        drafts.push(
          (
            await post(`${path}/drafts`, {
              data: { orderNumber: first.orderNumber },
            }).expect(201)
          ).body,
        );
      for (const draft of drafts)
        await request(server)
          .delete(`${path}/${draft.id}/draft`)
          .set('Cookie', cookie)
          .set('Origin', origin)
          .send({ expectedRevision: 1 })
          .expect(204);

      // A cancelled allocation frees its order; a completed one does not.
      await post(`${path}/${first.id}/cancel`, {
        expectedRevision: first.revision,
      }).expect(200);
      await create(again);

      const order = await fixtures.scheduledOrder(first.orderNumber);
      await fixtures.setUserRole(userId, 'admin');
      try {
        await request(server)
          .delete(`/api/order-schedule/${order.id}`)
          .set('Cookie', cookie)
          .set('Origin', origin)
          .send({ expectedRevision: order.revision })
          .expect(409);
        // Its quantity is fixed while an allocation was checked against it;
        // other fields still change.
        const edit = (body: object) =>
          request(server)
            .patch(`/api/order-schedule/${order.id}`)
            .set('Cookie', cookie)
            .set('Origin', origin)
            .send({ expectedRevision: order.revision, ...body });
        const fixed = await edit({ quantity: 5 }).expect(409);
        assert.deepEqual(issue(fixed.body), [
          { code: 'order_allocated', path: ['quantity'] },
        ]);
        await edit({ quantity: 1, note: 'Same quantity' }).expect(200);
      } finally {
        await fixtures.setUserRole(userId, 'user');
      }
    },
  );
  await t.test(
    'an order can be deleted once its allocation is cancelled, and is then off the schedule',
    async () => {
      const body = input(await seed());
      const allocation = await create(body);
      const draft = (
        await post(`${path}/drafts`, {
          data: { orderNumber: body.orderNumber },
        }).expect(201)
      ).body;
      const order = await fixtures.scheduledOrder(body.orderNumber);
      const asAdmin = async <T>(work: () => Promise<T>) => {
        await fixtures.setUserRole(userId, 'admin');
        try {
          return await work();
        } finally {
          await fixtures.setUserRole(userId, 'user');
        }
      };
      const schedule = (method: 'delete' | 'post', url: string) => {
        const agent = request(server);
        return (method === 'post' ? agent.post(url) : agent.delete(url))
          .set('Cookie', cookie)
          .set('Origin', origin);
      };
      const remove = () =>
        asAdmin(() =>
          schedule('delete', `/api/order-schedule/${order.id}`).send({
            // Milestone stamps leave the order's revision alone.
            expectedRevision: 1,
          }),
        );

      const refused = await remove();
      assert.equal(refused.status, 409);
      assert.equal(
        refused.body.message,
        'This order has an allocation. Cancel it before deleting the order.',
      );
      await post(`${path}/${allocation.id}/cancel`, {
        expectedRevision: allocation.revision,
      }).expect(200);
      // Neither the cancelled allocation nor the draft holds the order now.
      assert.equal((await remove()).status, 204);

      // A deleted order is not on the schedule for new work or drafts.
      const missing = [{ code: 'order_not_scheduled', path: ['orderNumber'] }];
      const issue = (reply: {
        body: { issues?: { code: string; path: unknown }[] };
      }) => reply.body.issues?.map(({ code, path }) => ({ code, path }));
      const again = { ...input(await seed()), orderNumber: body.orderNumber };
      assert.deepEqual(issue(await post(path, again).expect(404)), missing);
      assert.deepEqual(
        issue(
          await post(`${path}/drafts`, {
            data: { orderNumber: body.orderNumber },
          }).expect(404),
        ),
        missing,
      );
      assert.deepEqual(
        issue(
          await request(server)
            .put(`${path}/${draft.id}/draft`)
            .set('Cookie', cookie)
            .set('Origin', origin)
            .send({
              expectedRevision: 1,
              data: { orderNumber: body.orderNumber },
            })
            .expect(404),
        ),
        missing,
      );
      // The cancelled allocation still reads as it was.
      assert.equal(
        (await get(`${path}/${allocation.id}`).expect(200)).body.orderNumber,
        body.orderNumber,
      );

      // Scheduling the number again restores the order, here with a new
      // quantity: two blinds where the cancelled allocation planned one.
      const restored = await asAdmin(() =>
        schedule('post', '/api/order-schedule').send({
          orderNumber: body.orderNumber,
          shipDate: '2026-10-01',
          quantity: 2,
        }),
      );
      assert.equal(restored.status, 201);
      assert.equal(restored.body.id, order.id);
      assert.equal(restored.body.quantity, 2);
      // The cancelled allocation is history; nothing re-checks it.
      const cancelled = allocationDetailSchema.parse(
        (await get(`${path}/${allocation.id}`).expect(200)).body,
      );
      assert.equal(cancelled.state, 'cancelled');
      assert.equal(cancelled.requirements[0]!.quantity, 1);

      // New work answers to the new quantity, on a direct create and when a
      // draft is submitted; saving the draft is not checked.
      const mismatch = [
        { code: 'order_quantity_mismatch', path: ['orderNumber'] },
      ];
      const short = await post(path, again).expect(400);
      assert.deepEqual(issue(short), mismatch);
      assert.equal(
        short.body.message,
        'The order has 2 blinds but the allocation has 1.',
      );
      const planned = (
        await post(`${path}/drafts`, { data: again }).expect(201)
      ).body;
      assert.deepEqual(
        issue(
          await post(`${path}/${planned.id}/submit`, {
            expectedRevision: 1,
          }).expect(400),
        ),
        mismatch,
      );
      // The refused submission left the draft a draft and the order free.
      assert.equal(
        (await get(`${path}/${planned.id}`).expect(200)).body.state,
        'draft',
      );
      const two = {
        ...again,
        requirements: [{ ...again.requirements[0]!, quantity: 2 }],
        plan: { cuts: [again.plan.cuts[0]!, again.plan.cuts[0]!] },
      };
      await request(server)
        .put(`${path}/${planned.id}/draft`)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .send({ expectedRevision: 1, data: two })
        .expect(200);
      const confirmed = allocationDetailSchema.parse(
        (
          await post(`${path}/${planned.id}/submit`, {
            expectedRevision: 2,
          }).expect(200)
        ).body,
      );
      assert.equal(confirmed.state, 'active');
      assert.ok((await fixtures.scheduledOrder(body.orderNumber)).allocated_at);
      await request(server)
        .delete(`${path}/${draft.id}/draft`)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .send({ expectedRevision: 1 })
        .expect(204);
    },
  );
  await t.test(
    'confirming, moving, cancelling, and completing an allocation stamp its scheduled order',
    async () => {
      const order = fixtures.scheduledOrder;
      const allocationRow = async (id: string) =>
        (
          await pool.query(
            `SELECT confirmed_at, completed_at FROM allocations WHERE id=$1`,
            [id],
          )
        ).rows[0];
      const stockId = await seed();
      const body = input(stockId);
      const allocation = await create(body);
      const confirmedAt = (await allocationRow(allocation.id)).confirmed_at;
      let row = await order(body.orderNumber);
      assert.deepEqual(row.allocated_at, confirmedAt);
      assert.equal(row.cut_at, null);
      // Stamps leave the revision alone so an open admin edit stays current.
      assert.equal(row.revision, 1);

      // Both requests hold the foreign key's share lock on the order; the
      // loser must wait and see the stamp rather than deadlock.
      const contested = input(await seed()).orderNumber;
      const racers = await Promise.all(
        [await seed(), await seed()].map((stock) =>
          post(path, { ...input(stock), orderNumber: contested }),
        ),
      );
      assert.deepEqual(racers.map((reply) => reply.status).sort(), [201, 409]);
      assert.equal(
        racers.find((reply) => reply.status === 409)!.body.issues[0].code,
        'order_already_allocated',
      );

      // Replacing onto another order moves the milestone, keeping its time.
      const target = input(stockId).orderNumber;
      const moved = allocationDetailSchema.parse(
        (
          await put(allocation.id, {
            ...body,
            orderNumber: target,
            expectedRevision: allocation.revision,
          }).expect(200)
        ).body,
      );
      assert.equal((await order(body.orderNumber)).allocated_at, null);
      assert.deepEqual((await order(target)).allocated_at, confirmedAt);

      const shipped = input(stockId).orderNumber;
      await pool.query(
        `UPDATE scheduled_orders SET shipped_at=now() WHERE order_number=$1`,
        [shipped],
      );
      const late = await post(path, {
        ...input(await seed()),
        orderNumber: shipped,
      }).expect(409);
      assert.equal(late.body.issues[0].code, 'order_shipped');

      // Cancelling returns the order to scheduled, free to allocate again.
      await post(`${path}/${moved.id}/cancel`, {
        expectedRevision: moved.revision,
      }).expect(200);
      assert.equal((await order(target)).allocated_at, null);
      await post(`${path}/${moved.id}/cancel`, {
        expectedRevision: moved.revision,
      }).expect(200);
      const again = await create({ ...input(stockId), orderNumber: target });

      const completion = {
        expectedRevision: again.revision,
        items: [
          {
            stockItemId: stockId,
            expectedRevision: again.items[0]!.stockItem.revision,
            outcome: 'consumed',
            tubeOuterDiameterMm: 50,
          },
        ],
      };
      const key = randomUUID();
      await post(`${path}/${again.id}/complete`, completion, key).expect(200);
      await post(`${path}/${again.id}/complete`, completion, key).expect(200);
      const stamps = await allocationRow(again.id);
      row = await order(target);
      assert.deepEqual(row.allocated_at, stamps.confirmed_at);
      assert.deepEqual(row.cut_at, stamps.completed_at);
      assert.equal(row.revision, 1);
      assert.equal(
        (await get(`/api/order-schedule/${row.id}`).expect(200)).body.status,
        'cut',
      );

      // Each allocation event carries the order's change, so the order's
      // own history explains its milestones.
      const history = historySchema.parse(
        (await get(`/api/order-schedule/${row.id}/history`).expect(200)).body,
      );
      assert.deepEqual(history.items.map((event) => event.action).sort(), [
        'allocation.cancelled',
        'allocation.completed',
        'allocation.confirmed',
        'allocation.replaced',
      ]);
      const completedEvent = history.items.find(
        (event) => event.action === 'allocation.completed',
      )!;
      assert.deepEqual(
        completedEvent.changes.map((c) => c.recordType).slice(0, 2),
        ['allocations', 'order-schedule'],
      );
    },
  );
});
