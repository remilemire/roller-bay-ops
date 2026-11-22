import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  stationOrderListSchema,
  worksheetSchema,
} from '@roller-bay/shared/production';
import { startAllocationsApp } from '../allocations/testing/index.js';

test('checking replaces one blind on the same roll without rewriting the order or bypassing worksheet review', async (t) => {
  const { get, post, create, input, seed, ids, pool, userId } =
    await startAllocationsApp(t);
  await pool.query("UPDATE users SET role='admin' WHERE id=$1", [userId]);
  const employee = (
    await post('/api/employees', { name: 'Cutter', initials: 'CT' }).expect(201)
  ).body.id;
  const checker = (
    await post('/api/employees', { name: 'Checker', initials: 'CK' }).expect(
      201,
    )
  ).body.id;
  const stock = await seed(20000);
  const source = await input(stock);
  await pool.query('UPDATE work_orders SET quantity=3 WHERE id=$1', [
    source.workOrderId,
  ]);
  source.requirements[0]!.quantity = 3;
  source.plan.cuts = Array.from({ length: 3 }, () => ({
    stockItemId: stock,
    items: [{ requirementId: source.requirements[0]!.id, quantity: 1 }],
  }));
  const primary = await create(source);
  const order = primary.workOrderId;
  const path = '/api/production';
  const originalPath = `${path}/cutting/orders/${order}/worksheet`;
  const original = worksheetSchema.parse(
    (await post(originalPath, { employeeIds: [employee] }).expect(201)).body,
  );
  const submit = async (sheet: typeof original, depth: number) =>
    worksheetSchema.parse(
      (
        await post(`${path}/cutting/worksheets/${sheet.id}/submit`, {
          expectedRevision: sheet.revision,
          results: {
            expectedRevision: sheet.snapshot.revision,
            items: [
              {
                stockItemId: stock,
                expectedRevision: 1,
                outcome: 'returned-roll',
                tubeOuterDiameterMm: 50,
                radialDepthMm: depth,
                locationId: ids.location,
                scraps: [],
              },
            ],
          },
        }).expect(201)
      ).body,
    );
  const orderRequestPath = `${path}/orders/${order}/recuts`;
  const payload = {
    requirementId: source.requirements[0]!.id,
    quantity: 1,
    reason: 'Flaw across face',
  };
  const submitted = await submit(original, 10);
  const originalCompletions = (
    await get(`${path}/orders/${order}/completions`).expect(200)
  ).body;
  const requestPath = `${path}/checking/orders/${order}/recuts`;
  await pool.query(
    "UPDATE users SET role='production', stations=$1::jsonb WHERE id=$2",
    [JSON.stringify(['assembly']), userId],
  );
  const key = randomUUID();
  const [first, retry] = await Promise.all([
    post(orderRequestPath, payload, key).expect(201),
    post(orderRequestPath, payload, key).expect(201),
  ]);
  assert.deepEqual(first.body, retry.body);
  await pool.query(
    "UPDATE users SET role='admin',stations='[]'::jsonb WHERE id=$1",
    [userId],
  );
  assert.deepEqual(
    (await post(requestPath, payload, key).expect(201)).body,
    first.body,
  );
  await post(requestPath, { ...payload, quantity: 3 }).expect(400);
  await post(requestPath, { ...payload, reason: 'Changed' }, key).expect(409);
  const id = first.body.recordId;
  const shipping = () =>
    post(`${path}/shipping/orders/${order}/complete`, {
      employeeIds: [checker],
    });
  await shipping().expect(409);
  const candidates = (await get(`${path}/recuts/${id}/stock`).expect(200)).body;
  assert.ok(candidates.some((s: { id: string }) => s.id === stock));
  await pool.query(
    "UPDATE users SET role='production', stations='[\"checking\"]'::jsonb WHERE id=$1",
    [userId],
  );
  await post(`${path}/recuts/${id}/assign`, {
    expectedRevision: 1,
    stockItemId: stock,
  }).expect(403);
  await pool.query(
    "UPDATE users SET role='admin', stations='[]'::jsonb WHERE id=$1",
    [userId],
  );
  const assigned = await post(`${path}/recuts/${id}/assign`, {
    expectedRevision: 1,
    stockItemId: stock,
  }).expect(201);
  await post(`${path}/recuts/${id}/assign`, {
    expectedRevision: 1,
    stockItemId: stock,
  }).expect(409);
  const queue = stationOrderListSchema.parse(
    (await get(`${path}/cutting/orders`).expect(200)).body,
  );
  const task = queue.items.find((o) => o.id === order)!.recuts[0]!;
  assert.ok(task.allocationId && task.allocationId !== primary.id);
  const replacement = worksheetSchema.parse(
    (
      await post(
        `${path}/cutting/orders/${order}/recut-plans/${task.allocationId}/worksheet`,
        { employeeIds: [checker] },
      ).expect(201)
    ).body,
  );
  assert.equal(replacement.snapshot.isRecut, true);
  assert.equal(replacement.snapshot.requirements[0]!.quantity, 1);
  assert.equal((await get(originalPath).expect(200)).body.id, original.id);
  const second = await submit(replacement, 8);
  assert.deepEqual(
    (await get(`${path}/orders/${order}/completions`).expect(200)).body,
    originalCompletions,
  );
  const review = (sheet: typeof original) =>
    post(`${path}/cutting/worksheets/${sheet.id}/review`, {
      expectedRevision: sheet.revision,
    });
  await review(second).expect(409);
  await review(submitted).expect(201);
  await review(second).expect(201);
  const sign = (station: string, revision: number) =>
    post(`${path}/${station}/recuts/${id}/complete`, {
      expectedRevision: revision,
      employeeIds: [checker],
    });
  const afterCut = assigned.body.revision + 1;
  await sign('checking', afterCut).expect(409);
  const assembly = await sign('assembly', afterCut).expect(201);
  await shipping().expect(409);
  await sign('checking', assembly.body.revision).expect(201);
  assert.equal(
    (await get(`/api/work-orders/${order}`).expect(200)).body.quantity,
    3,
  );
  await shipping().expect(201);
});

test('a shipped order with a recorded cut gets a replacement and retains its original sign-offs', async (t) => {
  const { get, post, seed, input, create, pool, userId } =
    await startAllocationsApp(t);
  await pool.query("UPDATE users SET role='admin' WHERE id=$1", [userId]);
  const employeeIds = [
    (
      await post('/api/employees', {
        name: 'Robin Park',
        initials: 'RP',
      }).expect(201)
    ).body.id,
  ];
  const source = await create(await input(await seed()));
  const id = source.workOrderId,
    base = '/api/production',
    orderPath = `/api/work-orders/${id}`;
  await post(`${base}/cutting/orders/${id}/complete`, { employeeIds }).expect(
    201,
  );
  await post(`${base}/shipping/orders/${id}/complete`, { employeeIds }).expect(
    201,
  );
  const shipped = (await get(orderPath).expect(200)).body;
  assert.ok(shipped.shippedAt);
  assert.ok(shipped.cutAt);
  const originalCompletions = (
    await get(`${base}/orders/${id}/completions`).expect(200)
  ).body;
  await post(`${base}/cutting/orders/${id}/worksheet`, { employeeIds }).expect(
    409,
  );
  const requestPath = `${base}/orders/${id}/recuts`;
  const body = {
    requirementId: source.requirements[0]!.id,
    quantity: 1,
    reason: 'Customer reported damaged fabric',
  };
  await pool.query(
    "UPDATE users SET role='production',stations='[]'::jsonb WHERE id=$1",
    [userId],
  );
  await post(requestPath, body).expect(403);
  await pool.query("UPDATE users SET role='staff' WHERE id=$1", [userId]);
  const requested = (await post(requestPath, body).expect(201)).body;
  const replacementStock = await seed();
  await post(`${base}/recuts/${requested.recordId}/assign`, {
    expectedRevision: requested.revision,
    stockItemId: replacementStock,
  }).expect(201);
  const queue = async (station: string) =>
    stationOrderListSchema
      .parse((await get(`${base}/${station}/orders`).expect(200)).body)
      .items.find((row) => row.id === id);
  const planId = (await queue('cutting'))?.recuts[0]?.allocationId;
  assert.ok(planId);
  const sheet = worksheetSchema.parse(
    (
      await post(
        `${base}/cutting/orders/${id}/recut-plans/${planId}/worksheet`,
        { employeeIds },
      ).expect(201)
    ).body,
  );
  const worksheetPath = `${base}/cutting/worksheets/${sheet.id}`;
  const submitted = worksheetSchema.parse(
    (
      await post(`${worksheetPath}/submit`, {
        expectedRevision: sheet.revision,
        results: {
          expectedRevision: sheet.snapshot.revision,
          items: [
            {
              stockItemId: replacementStock,
              expectedRevision: sheet.snapshot.items[0]!.stockItem.revision,
              outcome: 'consumed',
              scraps: [],
            },
          ],
        },
      }).expect(201)
    ).body,
  );
  await post(`${worksheetPath}/review`, {
    expectedRevision: submitted.revision,
  }).expect(201);
  const assembly = (await queue('assembly'))?.recuts[0];
  assert.equal(assembly?.stage, 'assembly');
  await post(`${base}/assembly/recuts/${requested.recordId}/complete`, {
    expectedRevision: assembly!.revision,
    employeeIds,
  }).expect(201);
  const pending = (await queue('checking'))?.recuts[0];
  assert.equal(pending?.stage, 'checking');
  await post(`${base}/checking/recuts/${requested.recordId}/complete`, {
    expectedRevision: pending!.revision,
    employeeIds,
  }).expect(201);
  assert.equal(await queue('checking'), undefined);
  assert.deepEqual((await get(orderPath).expect(200)).body, shipped);
  assert.deepEqual(
    (await get(`${base}/orders/${id}/completions`).expect(200)).body,
    originalCompletions,
  );
});

test('a cutter reports a shortage, staff assign another roll, and the last replacement finishes the order cut', async (t) => {
  const { get, post, input, create, seed, pool, userId } =
    await startAllocationsApp(t);
  await pool.query("UPDATE users SET role='admin' WHERE id=$1", [userId]);
  const employeeIds = [
    (await post('/api/employees', { name: 'Jo', initials: 'JO' }).expect(201))
      .body.id,
  ];
  const planned = await input(await seed());
  const { workOrderId } = await create(planned);
  const base = '/api/production';
  const cutting = `${base}/cutting/orders/${workOrderId}`;
  const countPath = `${base}/recuts/pending-count`;
  const queuePath = `${base}/cutting/orders?view=recuts`;
  const primary = worksheetSchema.parse(
    (await post(`${cutting}/worksheet`, { employeeIds }).expect(201)).body,
  );
  await pool.query(
    `UPDATE users SET role='production', stations='["cutting"]'::jsonb WHERE id=$1`,
    [userId],
  );
  const requested = (
    await post(`${base}/orders/${workOrderId}/recuts`, {
      requirementId: planned.requirements[0]!.id,
      quantity: 1,
      reason: 'Roll ran short',
    }).expect(201)
  ).body;
  await get(countPath).expect(403);
  const submit = (sheet: typeof primary) =>
    post(`${base}/cutting/worksheets/${sheet.id}/submit`, {
      expectedRevision: sheet.revision,
      results: {
        expectedRevision: sheet.snapshot.revision,
        items: sheet.snapshot.items.map((i) => ({
          stockItemId: i.stockItemId,
          expectedRevision: i.stockItem.revision,
          outcome: 'consumed',
          scraps: [],
        })),
      },
    }).expect(201);
  await submit(primary);
  await post(`${cutting}/complete`, { employeeIds }).expect(409);
  await pool.query("UPDATE users SET role='staff' WHERE id=$1", [userId]);
  const order = async () =>
    (await get(`/api/work-orders/${workOrderId}`).expect(200)).body;
  assert.equal((await order()).cutAt, null);
  const exhausted = primary.snapshot.items[0]!.stockItemId;
  const candidates = (
    await get(`${base}/recuts/${requested.recordId}/stock`).expect(200)
  ).body;
  assert.ok(!candidates.some((s: { id: string }) => s.id === exhausted));
  await post(`${base}/recuts/${requested.recordId}/assign`, {
    expectedRevision: requested.revision,
    stockItemId: exhausted,
  }).expect(409);
  assert.equal((await get(countPath).expect(200)).body.total, 1);
  assert.deepEqual(
    stationOrderListSchema
      .parse((await get(queuePath).expect(200)).body)
      .items.map((row) => row.id),
    [workOrderId],
  );
  await post(`${base}/recuts/${requested.recordId}/assign`, {
    expectedRevision: requested.revision,
    stockItemId: await seed(),
  }).expect(201);
  assert.equal((await get(countPath).expect(200)).body.total, 0);
  assert.equal((await get(queuePath).expect(200)).body.total, 0);
  const [recut] = (
    await get(`${base}/orders/${workOrderId}/recuts`).expect(200)
  ).body;
  const replacement = worksheetSchema.parse(
    (
      await post(`${cutting}/recut-plans/${recut.allocationId}/worksheet`, {
        employeeIds,
      }).expect(201)
    ).body,
  );
  const finished = await submit(replacement);
  assert.equal((await order()).cutAt, finished.body.submittedAt);
  await submit(replacement);
  assert.equal((await order()).cutAt, finished.body.submittedAt);
});
