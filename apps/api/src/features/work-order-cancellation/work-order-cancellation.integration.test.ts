import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import request from 'supertest';
import { AuditService } from '../audit/audit.service.js';
import { startAllocationsApp } from '../allocations/testing/allocations-app.js';

test('order cancellation workflows', { timeout: 120_000 }, async (t) => {
  const {
    app,
    fixtures,
    userId,
    get,
    post,
    create,
    input,
    seed,
    pool,
    server,
    cookie,
    origin,
    ids,
  } = await startAllocationsApp(t);
  await fixtures.setUserRole(userId, 'admin');
  const employee = (
    await post('/api/employees', {
      name: 'Cancellation Cutter',
      initials: 'CC',
    }).expect(201)
  ).body;
  const context = async (id: string) =>
    (await get(`/api/work-orders/${id}/cancellation-context`).expect(200)).body;
  const command = async (id: string, skipCuttingResults = false) => {
    const c = await context(id);
    return {
      reason: 'Customer changed requirements',
      expectedRevision: c.order.revision,
      allocationId: c.allocation?.id ?? null,
      expectedAllocationRevision: c.allocation?.revision ?? null,
      worksheetId: c.worksheet?.id ?? null,
      expectedWorksheetRevision: c.worksheet?.revision ?? null,
      skipCuttingResults,
    };
  };
  const read = async (id: string) =>
    (await get(`/api/work-orders/${id}`).expect(200)).body;
  const cancel = (id: string, body: object, key?: string) =>
    post(`/api/work-orders/${id}/cancellation`, body, key);
  const begin = async (orderId: string) =>
    (
      await post(`/api/production/cutting/orders/${orderId}/worksheet`, {
        employeeId: employee.id,
      }).expect(201)
    ).body;
  const results = (a: Awaited<ReturnType<typeof create>>, stockId: string) => ({
    expectedRevision: a.revision,
    items: [
      {
        stockItemId: stockId,
        expectedRevision: 1,
        outcome: 'returned-roll',
        radialDepthMm: 10,
        tubeOuterDiameterMm: 50,
        locationId: ids.location,
        scraps: [],
      },
    ],
  });
  await t.test(
    'unschedule keeps reservations; cancellation preserves history and retries once',
    async () => {
      const planInput = await input(await seed());
      const a = await create(planInput);
      const order = await read(a.workOrderId);
      await request(server)
        .patch(`/api/work-orders/${order.id}`)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .send({ expectedRevision: order.revision, shipDate: '2026-10-02' })
        .expect(200);
      await request(server)
        .patch(`/api/work-orders/${order.id}`)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .send({
          expectedRevision: (await read(order.id)).revision,
          shipDate: null,
        })
        .expect(200);
      assert.ok((await read(order.id)).allocatedAt);
      const body = await command(order.id);
      const key = randomUUID();
      const accepted = await cancel(order.id, body, key).expect(200);
      assert.deepEqual(
        (await cancel(order.id, body, key).expect(200)).body,
        accepted.body,
      );
      await cancel(
        order.id,
        { ...body, reason: 'Changed request' },
        key,
      ).expect(409);
      const saved = await read(order.id);
      assert.equal(saved.status, 'cancelled');
      assert.equal(saved.allocatedAt, null);
      assert.equal(
        (await get(`/api/allocations/${a.id}`).expect(200)).body.state,
        'cancelled',
      );
      assert.equal(
        (
          await get(
            `/api/work-orders?status=open&search=${saved.orderNumber}`,
          ).expect(200)
        ).body.total,
        0,
      );
      assert.equal(
        (
          await get(
            `/api/work-orders?status=cancelled&search=${saved.orderNumber}`,
          ).expect(200)
        ).body.total,
        1,
      );
      await post('/api/allocations', {
        workOrderId: saved.id,
        plan: planInput.plan,
      }).expect(409);
      await post(`/api/production/assembly/orders/${saved.id}/complete`, {
        employeeId: employee.id,
      }).expect(409);
      const history = (
        await get(`/api/work-orders/${saved.id}/history`).expect(200)
      ).body;
      assert.equal(
        history.items.filter(
          (e: { action: string }) => e.action === 'order.cancelled',
        ).length,
        1,
      );
    },
  );
  await t.test(
    'skip results preserves milestones, measurements and the original worksheet',
    async () => {
      const stockId = await seed();
      const a = await create(await input(stockId));
      const sheet = await begin(a.workOrderId);
      await post(`/api/production/cutting/orders/${a.workOrderId}/complete`, {
        employeeId: employee.id,
      }).expect(201);
      const cutAt = (await read(a.workOrderId)).cutAt;
      const before = (
        await pool.query('SELECT * FROM fabric_stock_items WHERE id=$1', [
          stockId,
        ])
      ).rows[0];
      await cancel(a.workOrderId, await command(a.workOrderId)).expect(409);
      await cancel(a.workOrderId, await command(a.workOrderId, true)).expect(
        200,
      );
      assert.equal((await read(a.workOrderId)).cutAt, cutAt);
      assert.deepEqual(
        (
          await pool.query('SELECT * FROM fabric_stock_items WHERE id=$1', [
            stockId,
          ])
        ).rows[0],
        before,
      );
      const closed = (
        await get(`/api/production/cutting/worksheets/${sheet.id}`).expect(200)
      ).body;
      assert.ok(closed.skippedAt);
      assert.equal(closed.reviewedAt, null);
      assert.equal(closed.abandonedAt, null);
      await post(`/api/production/cutting/worksheets/${sheet.id}/submit`, {
        expectedRevision: sheet.revision,
        results: results(a, stockId),
      }).expect(409);
      assert.equal(
        (await get('/api/production/cutting/worksheets').expect(200)).body.some(
          (s: { id: string }) => s.id === sheet.id,
        ),
        false,
      );
      const next = await create(await input(stockId));
      const nextSheet = await begin(next.workOrderId);
      const submitted = (
        await post(
          `/api/production/cutting/worksheets/${nextSheet.id}/submit`,
          {
            expectedRevision: nextSheet.revision,
            results: results(next, stockId),
          },
        ).expect(201)
      ).body;
      await post(`/api/production/cutting/worksheets/${nextSheet.id}/review`, {
        expectedRevision: submitted.revision,
      }).expect(409);
      await post(`/api/production/cutting/worksheets/${nextSheet.id}/review`, {
        expectedRevision: submitted.revision,
        resolution: {
          reason: 'Verified current depth after skipped results',
          results: results(next, stockId),
        },
      }).expect(201);
    },
  );
  await t.test(
    'completed allocation release preserves stock and allows another allocation',
    async () => {
      const stockId = await seed();
      const a = await create(await input(stockId));
      await post(`/api/production/cutting/orders/${a.workOrderId}/complete`, {
        employeeId: employee.id,
      }).expect(201);
      await post(
        `/api/allocations/${a.id}/complete`,
        results(a, stockId),
      ).expect(200);
      const before = (
        await pool.query('SELECT * FROM fabric_stock_items WHERE id=$1', [
          stockId,
        ])
      ).rows[0];
      await post(
        `/api/allocations/${a.id}/cancellation`,
        await command(a.workOrderId),
      ).expect(200);
      const saved = (await get(`/api/allocations/${a.id}`).expect(200)).body;
      assert.equal(saved.state, 'completed');
      assert.ok(saved.releasedAt);
      assert.equal(saved.cancelledAt, null);
      const releasedOrder = await read(a.workOrderId);
      assert.equal(releasedOrder.status, 'cut');
      for (const [status, total] of [
        ['new', 0],
        ['cut', 1],
      ] as const)
        assert.equal(
          (
            await get(
              `/api/work-orders?status=${status}&search=${releasedOrder.orderNumber}`,
            ).expect(200)
          ).body.total,
          total,
        );
      assert.deepEqual(
        (
          await pool.query('SELECT * FROM fabric_stock_items WHERE id=$1', [
            stockId,
          ])
        ).rows[0],
        before,
      );
      const replacement = await seed();
      await post('/api/allocations', {
        workOrderId: a.workOrderId,
        plan: {
          cuts: a.plan.cuts.map((c) => ({
            stockItemId: replacement,
            items: c.items,
          })),
        },
      }).expect(201);
    },
  );
  await t.test(
    'allocation cancellation keeps the date and releases reservations; order cancellation clears both',
    async () => {
      const a = await create(await input(await seed()));
      const patch = (body: object) =>
        request(server)
          .patch(`/api/work-orders/${a.workOrderId}`)
          .set('Cookie', cookie)
          .set('Origin', origin)
          .send(body);
      await patch({
        expectedRevision: (await read(a.workOrderId)).revision,
        shipDate: '2026-10-02',
      }).expect(200);
      const scheduled = await read(a.workOrderId);
      const preview = (
        await get(`/api/allocations/${a.id}/cancellation-context`).expect(200)
      ).body;
      assert.equal(preview.order.shipDate, scheduled.shipDate);
      const body = await command(a.workOrderId);
      const key = randomUUID();
      const cancelled = await post(
        `/api/allocations/${a.id}/cancellation`,
        body,
        key,
      ).expect(200);
      assert.deepEqual(
        (
          await post(`/api/allocations/${a.id}/cancellation`, body, key).expect(
            200,
          )
        ).body,
        cancelled.body,
      );
      await post(
        `/api/allocations/${a.id}/cancellation`,
        { ...body, reason: 'Different' },
        key,
      ).expect(409);
      const released = await read(a.workOrderId);
      assert.equal(released.shipDate, scheduled.shipDate);
      assert.equal(released.scheduledAt, scheduled.scheduledAt);
      assert.equal(released.allocatedAt, null);
      assert.equal(released.cancelledAt, null);
      assert.equal(released.status, 'scheduled');
      assert.equal(
        (
          await get(
            `/api/work-orders?status=new&search=${released.orderNumber}`,
          ).expect(200)
        ).body.total,
        0,
      );
      await patch({
        expectedRevision: released.revision,
        shipDate: '2026-10-05',
      }).expect(409);
      await patch({
        expectedRevision: released.revision,
        note: 'Awaiting fabric',
      }).expect(200);
      await cancel(a.workOrderId, await command(a.workOrderId)).expect(200);
      const stopped = await read(a.workOrderId);
      assert.equal(stopped.shipDate, null);
      assert.equal(stopped.scheduledAt, null);
      assert.equal(stopped.allocatedAt, null);
      assert.equal(stopped.status, 'cancelled');
    },
  );
  await t.test('shipped orders and non-admins cannot cancel', async () => {
    const a = await create(await input(await seed()));
    await post(`/api/production/shipping/orders/${a.workOrderId}/complete`, {
      employeeId: employee.id,
    }).expect(201);
    const body = await command(a.workOrderId);
    await cancel(a.workOrderId, body).expect(409);
    await fixtures.setUserRole(userId, 'staff');
    await cancel(a.workOrderId, body).expect(403);
    await get(`/api/work-orders/${a.workOrderId}/cancellation-context`).expect(
      403,
    );
    await fixtures.setUserRole(userId, 'admin');
  });
  await t.test(
    'cancelled orders reject new production but retain explicit historical corrections',
    async () => {
      const a = await create(await input(await seed()));
      const path = `/api/production/assembly/orders/${a.workOrderId}`;
      await post(`${path}/complete`, { employeeId: employee.id }).expect(201);
      await cancel(a.workOrderId, await command(a.workOrderId, true)).expect(
        200,
      );
      const cancelled = await read(a.workOrderId);
      await post(`${path}/complete`, { employeeId: employee.id }).expect(409);
      const correction = {
        expectedRevision: cancelled.revision,
        employeeId: employee.id,
        completedAt: new Date(Date.now() - 60_000).toISOString(),
        reason: 'Correct the recorded assembly time',
      };
      const key = randomUUID();
      const first = await post(`${path}/corrections`, correction, key).expect(
        201,
      );
      assert.deepEqual(
        (await post(`${path}/corrections`, correction, key).expect(201)).body,
        first.body,
      );
      await post(`${path}/corrections`, correction).expect(409);
      const corrected = await read(a.workOrderId);
      assert.equal(corrected.assembledAt, correction.completedAt);
      assert.equal(corrected.cancelledAt, cancelled.cancelledAt);
      assert.equal(corrected.status, 'cancelled');
      await post(`${path}/corrections`, {
        expectedRevision: corrected.revision,
        employeeId: null,
        completedAt: null,
        reason: 'Assembly was attributed to the wrong order',
      }).expect(201);
      assert.equal((await read(a.workOrderId)).assembledAt, null);
    },
  );
  await t.test(
    'stale previews and audit failures roll back all effects',
    async () => {
      const stockId = await seed();
      const a = await create(await input(stockId));
      const stale = await command(a.workOrderId);
      const sheet = await begin(a.workOrderId);
      await cancel(a.workOrderId, stale).expect(409);
      const body = await command(a.workOrderId, true);
      const audit = t.mock.method(app.get(AuditService), 'record', async () => {
        throw new Error('Audit unavailable');
      });
      await cancel(a.workOrderId, body).expect(503);
      audit.mock.restore();
      assert.equal((await read(a.workOrderId)).cancelledAt, null);
      assert.equal(
        (await get(`/api/allocations/${a.id}`).expect(200)).body.state,
        'active',
      );
      assert.equal(
        (
          await get(`/api/production/cutting/worksheets/${sheet.id}`).expect(
            200,
          )
        ).body.skippedAt,
        null,
      );
      const race = await Promise.all([
        cancel(a.workOrderId, body),
        post(`/api/production/cutting/worksheets/${sheet.id}/submit`, {
          expectedRevision: sheet.revision,
          results: results(a, stockId),
        }),
      ]);
      assert.equal(race.filter((r) => r.status === 409).length, 1);
      assert.equal(
        race.filter((r) => r.status === 200 || r.status === 201).length,
        1,
      );
    },
  );
});
