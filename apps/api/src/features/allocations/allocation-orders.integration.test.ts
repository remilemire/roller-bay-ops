import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import request from 'supertest';
import { historySchema } from '@roller-bay/shared/audit';
import {
  allocationDetailSchema,
  allocationDraftSchema,
  type CreateAllocation,
} from '@roller-bay/shared/allocations';
import { workOrderDetailSchema } from '@roller-bay/shared/work-orders';
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
  const issue = (reply: {
    body: { issues?: { code: string; path: unknown }[] };
  }) => reply.body.issues?.map(({ code, path }) => ({ code, path }));
  const missing = [{ code: 'order_not_found', path: ['workOrderId'] }];
  const taken = [{ code: 'order_already_allocated', path: ['workOrderId'] }];
  const notOnOrder = [
    {
      code: 'line_not_on_order',
      path: ['plan', 'cuts', 0, 'items', 0, 'requirementId'],
    },
  ];
  /** The same order's blinds cut from other stock. */
  const onto = (body: CreateAllocation, stockItemId: string) => ({
    ...body,
    plan: { cuts: [{ ...body.plan.cuts[0]!, stockItemId }] },
  });
  const asAdmin = async <T>(work: () => Promise<T>) => {
    await fixtures.setUserRole(userId, 'admin');
    try {
      return await work();
    } finally {
      await fixtures.setUserRole(userId, 'staff');
    }
  };
  const orders = (method: 'delete' | 'patch' | 'post' | 'put', url: string) => {
    const agent = request(server);
    return agent[method](`/api/work-orders${url}`)
      .set('Cookie', cookie)
      .set('Origin', origin);
  };
  const draftRequest = (method: 'put' | 'delete', id: string) => {
    const agent = request(server);
    return agent[method](`${path}/${id}/draft`)
      .set('Cookie', cookie)
      .set('Origin', origin);
  };

  await t.test(
    "an allocation plans an existing order's blinds, and an order has one live allocation",
    async () => {
      const unknown = {
        ...(await input(await seed())),
        workOrderId: randomUUID(),
      };
      assert.deepEqual(issue(await post(path, unknown).expect(404)), missing);
      assert.deepEqual(
        issue(await post(`${path}/drafts`, { data: unknown }).expect(404)),
        missing,
      );

      // An order with no blinds has nothing to plan, and is not claimed.
      const empty = await fixtures.createWorkOrder('200001');
      const nothing = await post(path, {
        ...(await input(await seed())),
        workOrderId: empty.id,
      }).expect(400);
      assert.deepEqual(issue(nothing), [
        { code: 'order_has_no_lines', path: ['workOrderId'] },
      ]);
      assert.equal((await fixtures.workOrder(empty.id)).allocated_at, null);

      const body = await input(await seed());
      // A plan assigns its own order's blinds, confirmed or draft.
      const foreign = { ...body, plan: (await input(await seed())).plan };
      for (const reply of [
        await post(path, foreign).expect(400),
        await post(`${path}/drafts`, { data: foreign }).expect(400),
      ])
        assert.deepEqual(issue(reply), notOnOrder);
      assert.equal(
        (await fixtures.workOrder(body.workOrderId)).allocated_at,
        null,
      );

      // Allocating reads the order and stamps one milestone; it never creates
      // an order or edits one, its blinds included.
      const before = await fixtures.workOrder(body.workOrderId);
      const lines = async () =>
        (await pool.query(`SELECT * FROM work_order_lines ORDER BY id`)).rows;
      const count = async () =>
        (await pool.query(`SELECT count(*) FROM work_orders`)).rows[0].count;
      const [ordersBefore, linesBefore] = [await count(), await lines()];
      const first = await create(body);
      assert.equal(first.workOrderId, body.workOrderId);
      assert.equal(first.orderNumber, before.order_number);
      const draft = allocationDraftSchema.parse(
        (await post(`${path}/drafts`, { data: body }).expect(201)).body,
      );
      await put(first.id, {
        plan: onto(body, await seed()).plan,
        expectedRevision: first.revision,
      }).expect(200);
      const after = await fixtures.workOrder(body.workOrderId);
      assert.ok(after.allocated_at);
      assert.deepEqual(
        { ...after, allocated_at: null, updated_at: before.updated_at },
        before,
      );
      assert.equal(await count(), ordersBefore);
      assert.deepEqual(await lines(), linesBefore);

      // A second plan for the order is refused, from a request or a draft.
      const again = onto(body, await seed());
      assert.deepEqual(issue(await post(path, again).expect(409)), taken);
      assert.deepEqual(
        issue(
          await post(`${path}/${draft.id}/submit`, {
            expectedRevision: 1,
          }).expect(409),
        ),
        taken,
      );
      // An allocation stays with its order: a replan names none.
      await put(first.id, { ...again, expectedRevision: 2 }).expect(400);

      // Drafts claim nothing, so any number may plan the order.
      const second = (await post(`${path}/drafts`, { data: again }).expect(201))
        .body;
      for (const id of [draft.id, second.id])
        await draftRequest('delete', id)
          .send({ expectedRevision: 1 })
          .expect(204);

      // While allocated the order cannot be deleted; a cancelled allocation
      // frees it.
      const refused = await asAdmin(() =>
        orders('delete', `/${body.workOrderId}`).send({
          expectedRevision: before.revision,
        }),
      );
      assert.equal(refused.status, 409);
      assert.equal(
        refused.body.message,
        'This order has an allocation. Cancel it before deleting the order.',
      );
      await post(`${path}/${first.id}/cancel`, { expectedRevision: 2 }).expect(
        200,
      );
      await create(again);
    },
  );

  await t.test(
    "a deleted order is gone for new work, and changing a restored order's blinds leaves past plans as they were",
    async () => {
      const body = await input(await seed());
      const allocation = await create(body);
      const draft = allocationDraftSchema.parse(
        (await post(`${path}/drafts`, { data: body }).expect(201)).body,
      );
      const order = await fixtures.workOrder(body.workOrderId);
      await post(`${path}/${allocation.id}/cancel`, {
        expectedRevision: allocation.revision,
      }).expect(200);
      // Neither the cancelled allocation nor the draft holds the order now.
      await asAdmin(() =>
        orders('delete', `/${order.id}`)
          // Milestone stamps leave the order's revision alone.
          .send({ expectedRevision: 1 })
          .expect(204),
      );

      const stock = await seed();
      assert.deepEqual(
        issue(await post(path, onto(body, stock)).expect(404)),
        missing,
      );
      assert.deepEqual(
        issue(await post(`${path}/drafts`, { data: body }).expect(404)),
        missing,
      );
      assert.deepEqual(
        issue(
          await draftRequest('put', draft.id)
            .send({ expectedRevision: 1, data: body })
            .expect(404),
        ),
        missing,
      );
      // The cancelled allocation still reads as it was.
      assert.equal(
        (await get(`${path}/${allocation.id}`).expect(200)).body.orderNumber,
        order.order_number,
      );

      // An employee cannot bring back what an admin deleted; an admin can,
      // and the order returns with its blinds.
      const denied = await orders('post', '').send({
        orderNumber: order.order_number,
      });
      assert.equal(denied.status, 409);
      assert.deepEqual(issue(denied), [
        { code: 'order_deleted', path: ['orderNumber'] },
      ]);
      const back = await asAdmin(() =>
        orders('post', '')
          .send({ orderNumber: order.order_number })
          .expect(201),
      );
      assert.equal(back.body.id, order.id);
      const restored = workOrderDetailSchema.parse(
        (await get(`/api/work-orders/${order.id}`).expect(200)).body,
      );
      const [blind] = restored.lines;
      assert.equal(blind!.id, body.plan.cuts[0]!.items[0]!.requirementId);

      // The blind changes, which retires it for a new one: two of them now.
      const changed = { ...blind!, id: randomUUID(), quantity: 2 };
      await orders('put', `/${order.id}/lines`)
        .send({ expectedRevision: restored.revision, lines: [changed] })
        .expect(200);
      // The cancelled allocation is history: it shows the blind it planned.
      const cancelled = allocationDetailSchema.parse(
        (await get(`${path}/${allocation.id}`).expect(200)).body,
      );
      assert.equal(cancelled.state, 'cancelled');
      assert.deepEqual(
        cancelled.requirements.map(({ id, quantity }) => ({ id, quantity })),
        [{ id: blind!.id, quantity: 1 }],
      );
      // The draft opens with the order's blinds as they are now and without
      // the assignment of the blind that went, so it cannot be confirmed.
      const stale = allocationDraftSchema.parse(
        (await get(`${path}/${draft.id}`).expect(200)).body,
      );
      assert.deepEqual(
        stale.data.requirements.map(({ id, quantity }) => ({ id, quantity })),
        [{ id: changed.id, quantity: 2 }],
      );
      assert.deepEqual(stale.data.plan.cuts[0]!.items, []);
      await post(`${path}/${draft.id}/submit`, { expectedRevision: 1 }).expect(
        400,
      );
      assert.equal(
        (await get(`${path}/${draft.id}`).expect(200)).body.state,
        'draft',
      );
      // Saving the old assignment again is refused outright.
      assert.deepEqual(
        issue(
          await draftRequest('put', draft.id)
            .send({ expectedRevision: 1, data: body })
            .expect(400),
        ),
        notOnOrder,
      );

      // Replanned for the new blind, the draft confirms and claims the order.
      const cut = {
        stockItemId: stock,
        items: [{ requirementId: changed.id, quantity: 1 }],
      };
      await draftRequest('put', draft.id)
        .send({
          expectedRevision: 1,
          data: { workOrderId: order.id, plan: { cuts: [cut, cut] } },
        })
        .expect(200);
      const confirmed = allocationDetailSchema.parse(
        (
          await post(`${path}/${draft.id}/submit`, {
            expectedRevision: 2,
          }).expect(200)
        ).body,
      );
      assert.equal(confirmed.state, 'active');
      assert.ok((await fixtures.workOrder(order.id)).allocated_at);
      // Its blinds are fixed from here.
      const frozen = await orders('put', `/${order.id}/lines`).send({
        expectedRevision: restored.revision + 1,
        lines: [],
      });
      assert.equal(frozen.status, 409);
      assert.deepEqual(issue(frozen), [
        { code: 'order_allocated', path: ['lines'] },
      ]);
    },
  );

  await t.test(
    'confirming, cancelling, and completing an allocation stamp its order, which keeps its allocation while it has a ship date',
    async () => {
      const order = (id: string) => fixtures.workOrder(id);
      const allocationRow = async (id: string) =>
        (
          await pool.query(
            `SELECT confirmed_at, completed_at FROM allocations WHERE id=$1`,
            [id],
          )
        ).rows[0];
      const stockId = await seed();
      const body = await input(stockId);
      const target = body.workOrderId;
      const allocation = await create(body);
      const confirmedAt = (await allocationRow(allocation.id)).confirmed_at;
      let row = await order(target);
      assert.deepEqual(row.allocated_at, confirmedAt);
      assert.equal(row.cut_at, null);
      // Stamps leave the revision alone so an open admin edit stays current.
      assert.equal(row.revision, 1);

      // Both requests hold the foreign key's share lock on the order; the
      // loser must wait and see the stamp rather than deadlock.
      const contested = await input(await seed());
      const racers = await Promise.all([
        post(path, contested),
        post(path, onto(contested, await seed())),
      ]);
      assert.deepEqual(racers.map((reply) => reply.status).sort(), [201, 409]);
      assert.deepEqual(
        issue(racers.find((reply) => reply.status === 409)!),
        taken,
      );

      // Saving an order's blinds takes the same lock as allocating it, so one
      // of the two wins outright: a plan is never confirmed for blinds that
      // were changing under it.
      const racing = await input(await seed());
      const [saved, allocated] = await Promise.all([
        orders('put', `/${racing.workOrderId}/lines`).send({
          expectedRevision: 1,
          lines: [],
        }),
        post(path, racing),
      ]);
      assert.deepEqual(
        [saved.status, allocated.status],
        saved.status === 200 ? [200, 400] : [409, 201],
      );

      const shipped = await input(await seed());
      await pool.query(`UPDATE work_orders SET shipped_at=now() WHERE id=$1`, [
        shipped.workOrderId,
      ]);
      assert.deepEqual(issue(await post(path, shipped).expect(409)), [
        { code: 'order_shipped', path: ['workOrderId'] },
      ]);

      // An order with a ship date keeps its allocation: cancelling is refused
      // rather than quietly taking the order off the schedule.
      const schedule = (shipDate: string | null) =>
        asAdmin(async () => {
          const current = await order(target);
          await orders('patch', `/${target}`)
            .send({ expectedRevision: current.revision, shipDate })
            .expect(200);
        });
      const shipDate = async () =>
        (await get(`/api/work-orders/${target}`).expect(200)).body.shipDate;
      await schedule('2026-10-09');
      const refused = await post(`${path}/${allocation.id}/cancel`, {
        expectedRevision: allocation.revision,
      }).expect(409);
      assert.deepEqual(issue(refused), [
        { code: 'order_scheduled', path: ['workOrderId'] },
      ]);
      assert.ok((await order(target)).allocated_at);
      // Re-planning in place releases nothing, so it keeps the date.
      const replanned = allocationDetailSchema.parse(
        (
          await put(allocation.id, {
            plan: onto(body, await seed()).plan,
            expectedRevision: allocation.revision,
          }).expect(200)
        ).body,
      );
      assert.equal(await shipDate(), '2026-10-09');
      await schedule(null);

      // Cancelling returns the order to new, free to allocate again with the
      // same blinds.
      await post(`${path}/${replanned.id}/cancel`, {
        expectedRevision: replanned.revision,
      }).expect(200);
      assert.equal((await order(target)).allocated_at, null);
      await post(`${path}/${replanned.id}/cancel`, {
        expectedRevision: replanned.revision,
      }).expect(200);
      const again = await create(body);
      // The two schedule edits above are what raised the order's revision.
      const { revision } = await order(target);

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
      assert.equal(row.cut_at, null);
      assert.ok(stamps.completed_at);
      assert.equal(row.revision, revision);
      assert.equal(
        (await get(`/api/work-orders/${row.id}`).expect(200)).body.status,
        'allocated',
      );

      // The order timeline includes related events even when they do not
      // change the order's own fields. Multi-record events appear only once.
      const history = historySchema.parse(
        (await get(`/api/work-orders/${row.id}/history`).expect(200)).body,
      );
      assert.deepEqual(history.items.map((event) => event.action).sort(), [
        'allocation.cancelled',
        'allocation.completed',
        'allocation.confirmed',
        'allocation.confirmed',
        'allocation.replaced',
        'order.scheduled',
        'order.unscheduled',
      ]);
      assert.ok(
        history.items.some((event) => event.action === 'allocation.completed'),
      );
    },
  );
});
