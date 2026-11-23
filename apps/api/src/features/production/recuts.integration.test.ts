import http from 'supertest';
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

test('three different-sized recuts share a reservation and worksheet and retain independent sign-offs', async (t) => {
  const { get, post, input, create, seed, pool, userId } =
    await startAllocationsApp(t);
  await pool.query("UPDATE users SET role='admin' WHERE id=$1", [userId]);
  const employeeIds = [
    (
      await post('/api/employees', { name: 'Cutter', initials: 'CT' }).expect(
        201,
      )
    ).body.id,
  ];
  const stock = await seed();
  const source = await input(stock);
  const order = source.workOrderId;
  await pool.query('UPDATE work_orders SET quantity=3 WHERE id=$1', [order]);
  source.requirements = [200, 300, 400].map((widthMm, i) => ({
    ...source.requirements[0]!,
    id: randomUUID(),
    widthMm,
    lengthMm: 600 + 50 * i,
  }));
  source.plan.cuts = [
    {
      stockItemId: stock,
      items: source.requirements.map((r) => ({
        requirementId: r.id,
        quantity: 1,
      })),
    },
  ];
  await create(source);
  const base = '/api/production';
  const path = `${base}/orders/${order}/recuts`;
  const requests: { id: string; expectedRevision: number }[] = [];
  for (const requirement of source.requirements) {
    const result = (
      await post(path, {
        requirementId: requirement.id,
        quantity: 1,
        reason: `Flaw on ${requirement.widthMm}`,
      }).expect(201)
    ).body;
    requests.push({ id: result.recordId, expectedRevision: result.revision });
  }
  const [first, ...additionalRecuts] = requests;
  const action = `${base}/recuts/${first!.id}`;
  const narrow = await seed(2000, true);
  await pool.query('UPDATE fabric_stock_items SET width_mm=350 WHERE id=$1', [
    narrow,
  ]);
  const replacement = await seed(1100, true);
  const candidates = (
    await post(`${action}/stock-options`, { additionalRecuts }).expect(200)
  ).body as { id: string }[];
  assert.ok(candidates.some((r) => r.id === replacement));
  assert.ok(!candidates.some((r) => r.id === narrow));
  const assignment = {
    expectedRevision: 1,
    additionalRecuts,
    stockItemId: replacement,
  };
  await post(`${action}/assign`, { ...assignment, stockItemId: narrow }).expect(
    409,
  );
  await post(`${action}/assign`, {
    ...assignment,
    additionalRecuts: [{ ...additionalRecuts[0], expectedRevision: 9 }],
  }).expect(409);
  const list = async () =>
    (await get(path).expect(200)).body as {
      id: string;
      stage: string;
      allocationId: string | null;
      revision: number;
    }[];
  assert.ok(
    (await list()).every(
      (r) => r.stage === 'requested' && r.allocationId === null,
    ),
  );
  const key = randomUUID();
  const assigned = await post(`${action}/assign`, assignment, key).expect(201);
  assert.deepEqual(
    (await post(`${action}/assign`, assignment, key).expect(201)).body,
    assigned.body,
  );
  const group = await list();
  const plan = group[0]!.allocationId;
  assert.ok(
    plan &&
      group.length === 3 &&
      group.every((r) => r.allocationId === plan && r.stage === 'cutting'),
  );
  const sheet = worksheetSchema.parse(
    (
      await post(
        `${base}/cutting/orders/${order}/recut-plans/${plan}/worksheet`,
        { employeeIds },
      ).expect(201)
    ).body,
  );
  assert.equal(sheet.snapshot.items.length, 1);
  assert.equal(sheet.snapshot.plan.cuts.length, 1);
  assert.equal(sheet.snapshot.plan.cuts[0]!.items.length, 3);
  await post(`${base}/cutting/worksheets/${sheet.id}/submit`, {
    expectedRevision: sheet.revision,
    results: {
      expectedRevision: sheet.snapshot.revision,
      items: [
        {
          stockItemId: replacement,
          expectedRevision: sheet.snapshot.items[0]!.stockItem.revision,
          outcome: 'consumed',
          scraps: [],
        },
      ],
    },
  }).expect(201);
  const cut = await list();
  assert.ok(cut.every((r) => r.stage === 'assembly'));
  await post(`${base}/assembly/recuts/${first!.id}/complete`, {
    expectedRevision: cut.find((r) => r.id === first!.id)!.revision,
    employeeIds,
  }).expect(201);
  assert.deepEqual((await list()).map((r) => r.stage).sort(), [
    'assembly',
    'assembly',
    'checking',
  ]);
});

test('withdrawing from a started shared sheet retires it and regenerates the remaining cuts on the same remnant', async (t) => {
  const {
    post,
    get,
    create,
    input,
    seed,
    pool,
    userId,
    server,
    cookie,
    origin,
  } = await startAllocationsApp(t);
  await pool.query("UPDATE users SET role='admin' WHERE id=$1", [userId]);
  const employeeIds = [
    (await post('/api/employees', { name: 'Sam', initials: 'SM' }).expect(201))
      .body.id,
  ];
  const planned = await input(await seed());
  planned.requirements[0]!.quantity = 4;
  planned.plan.cuts.push(structuredClone(planned.plan.cuts[0]!));
  planned.plan.cuts[1]!.items[0]!.quantity = 2;
  planned.plan.cuts[0]!.items[0]!.quantity = 2;
  await pool.query('UPDATE work_orders SET quantity=4 WHERE id=$1', [
    planned.workOrderId,
  ]);
  await create(planned);
  const base = '/api/production';
  const requests = `${base}/orders/${planned.workOrderId}/recuts`;
  const request = async (reason: string) =>
    (
      await post(requests, {
        requirementId: planned.requirements[0]!.id,
        quantity: 2,
        reason,
      }).expect(201)
    ).body;
  const first = await request('Flaw');
  const peer = await request('Short cut');
  const remnant = await seed(2100, true);
  const firstPath = `${base}/recuts/${first.recordId}`;
  const assigned = await post(`${firstPath}/assign`, {
    expectedRevision: first.revision,
    additionalRecuts: [{ id: peer.recordId, expectedRevision: peer.revision }],
    stockItemId: remnant,
  }).expect(201);
  const queue = stationOrderListSchema.parse(
    (await get(`${base}/cutting/orders`).expect(200)).body,
  );
  const plan = queue.items.find((o) => o.id === planned.workOrderId)!.recuts[0]!
    .allocationId!;
  const cutting = `${base}/cutting/orders/${planned.workOrderId}`;
  const path = (allocationId: string) =>
    `${cutting}/recut-plans/${allocationId}/worksheet`;
  const original = worksheetSchema.parse(
    (await post(path(plan), { employeeIds }).expect(201)).body,
  );
  const abandon = (sheet: typeof original) =>
    post(`${base}/cutting/worksheets/${sheet.id}/abandon`, {
      expectedRevision: sheet.revision,
      reason: 'No fabric cut',
    });
  await pool.query(
    "UPDATE users SET role='production',stations=$2::jsonb WHERE id=$1",
    [userId, JSON.stringify(['cutting'])],
  );
  await abandon(original).expect(201);
  const primary = worksheetSchema.parse(
    (await post(`${cutting}/worksheet`, { employeeIds }).expect(201)).body,
  );
  await abandon(primary).expect(403);
  const sheet = worksheetSchema.parse(
    (await post(path(plan), { employeeIds }).expect(201)).body,
  );
  assert.notEqual(sheet.id, original.id);
  assert.equal(
    sheet.snapshot.requirements.reduce((total, r) => total + r.quantity, 0),
    4,
  );
  await pool.query("UPDATE users SET role='staff' WHERE id=$1", [userId]);
  const body = {
    expectedRevision: assigned.body.revision,
    reason: 'Original blind passed checking',
  };
  await post(`${firstPath}/withdraw`, body).expect(409);
  await post(`${firstPath}/withdraw`, {
    ...body,
    unusedWorksheet: { id: sheet.id, expectedRevision: sheet.revision + 1 },
  }).expect(409);
  const key = randomUUID();
  const withdraw = () =>
    post(
      `${firstPath}/withdraw`,
      {
        ...body,
        unusedWorksheet: { id: sheet.id, expectedRevision: sheet.revision },
      },
      key,
    ).expect(201);
  assert.deepEqual((await withdraw()).body, (await withdraw()).body);
  const rows = (await get(requests).expect(200)).body as {
    id: string;
    stage: string;
    allocationId: string | null;
    revision: number;
  }[];
  const remaining = rows.find((r) => r.id === peer.recordId)!;
  assert.equal(rows.find((r) => r.id === first.recordId)?.stage, 'withdrawn');
  assert.equal(remaining.stage, 'cutting');
  assert.ok(remaining.allocationId && remaining.allocationId !== plan);
  await get(path(plan)).expect(409);
  const fresh = worksheetSchema.parse(
    (await post(path(remaining.allocationId), { employeeIds }).expect(201))
      .body,
  );
  assert.notEqual(fresh.id, sheet.id);
  assert.equal(fresh.snapshot.items[0]!.stockItemId, remnant);
  assert.deepEqual(
    fresh.snapshot.requirements.map((r) => r.quantity),
    [2],
  );
  assert.equal(fresh.snapshot.plan.cuts.length, 1);
  const draft = {
    form: {
      items: [
        {
          stockItemId: remnant,
          expectedRevision: 1,
          outcome: 'consumed',
          tube: '',
          depth: '',
          width: '',
          length: '',
          locationId: '',
          scraps: [],
        },
      ],
    },
    units: (await get('/api/auth/me')).body.measurementUnits,
    checkedCuts: [0],
  };
  const saved = worksheetSchema.parse(
    (
      await http(server)
        .put(`${base}/cutting/worksheets/${fresh.id}/draft`)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .send({ expectedRevision: fresh.revision, draft })
        .expect(200)
    ).body,
  );
  await abandon(saved).expect(409);
  await post(`${base}/recuts/${remaining.id}/withdraw`, {
    expectedRevision: remaining.revision,
    reason: 'Already started',
    unusedWorksheet: { id: fresh.id, expectedRevision: saved.revision },
  }).expect(409);
  const retired = (
    await get(`${base}/cutting/worksheets/${sheet.id}`).expect(200)
  ).body;
  assert.ok(retired.abandonedAt);
  assert.equal(retired.snapshot.requirements.length, 2);
});

test('staff can split manual recuts across remnants, validate without reserving, and start one worksheet', async (t) => {
  const { pool, userId, input, create, seed, get, post } =
    await startAllocationsApp(t);
  await pool.query("UPDATE users SET role='admin' WHERE id=$1", [userId]);
  const employeeIds = [
    (await post('/api/employees', { name: 'Lee', initials: 'LE' }).expect(201))
      .body.id,
  ];
  const primary = await input(await seed(), 1000);
  primary.requirements[0]!.quantity = 3;
  primary.plan.cuts.push(
    ...Array.from({ length: 2 }, () => structuredClone(primary.plan.cuts[0]!)),
  );
  await pool.query('UPDATE work_orders SET quantity=3 WHERE id=$1', [
    primary.workOrderId,
  ]);
  await create(primary);
  const base = '/api/production';
  const list = `${base}/orders/${primary.workOrderId}/recuts`;
  const request = async (quantity: number) =>
    (
      await post(list, {
        requirementId: primary.requirements[0]!.id,
        quantity,
        reason: 'Flaw',
      }).expect(201)
    ).body.recordId as string;
  const first = await request(2),
    other = await request(1);
  const a = await seed(1000, true),
    b = await seed(1000, true);
  await pool.query('UPDATE fabric_stock_items SET width_mm=600 WHERE id=$1', [
    a,
  ]);
  const action = `${base}/recuts/${first}`;
  const selection = { additionalRecuts: [{ id: other, expectedRevision: 1 }] };
  const candidates = async (route: string) =>
    (await post(`${action}/${route}`, selection).expect(200)).body as {
      id: string;
    }[];
  const manual = await candidates('manual-stock');
  assert.ok([a, b].every((id) => manual.some((s) => s.id === id)));
  assert.ok(
    !(await candidates('stock-options')).some((s) => s.id === a || s.id === b),
  );
  const body = {
    ...selection,
    expectedRevision: 1,
    plan: {
      cuts: [
        { stockItemId: a, items: [{ requirementId: first, quantity: 1 }] },
        {
          stockItemId: b,
          items: [
            { requirementId: other, quantity: 1 },
            { requirementId: first, quantity: 1 },
          ],
        },
      ],
    },
  };
  const invalid = { ...body, plan: { cuts: [body.plan.cuts[0]] } };
  await post(`${action}/validate-plan`, invalid).expect(400);
  await post(`${action}/assign`, invalid).expect(400);
  await pool.query(
    "UPDATE users SET role='production',stations=$1::jsonb WHERE id=$2",
    [JSON.stringify(['cutting']), userId],
  );
  await post(`${action}/manual-stock`, selection).expect(403);
  await post(`${action}/validate-plan`, body).expect(403);
  await post(`${action}/assign`, body).expect(403);
  await pool.query("UPDATE users SET role='staff' WHERE id=$1", [userId]);
  const preview = await post(`${action}/validate-plan`, body).expect(200);
  assert.equal(preview.body.stockItemCount, 2);
  assert.ok(
    (await get(list)).body.every(
      (r: { stage: string }) => r.stage === 'requested',
    ),
  );
  await pool.query(
    'UPDATE fabric_stock_items SET explicit_length_mm=999 WHERE id=$1',
    [b],
  );
  await post(`${action}/assign`, body).expect(409);
  assert.ok(
    (await get(list)).body.every(
      (r: { allocationId: string | null }) => r.allocationId === null,
    ),
  );
  await pool.query(
    'UPDATE fabric_stock_items SET explicit_length_mm=1000 WHERE id=$1',
    [b],
  );
  const key = randomUUID();
  const save = () => post(`${action}/assign`, body, key).expect(201);
  assert.deepEqual((await save()).body, (await save()).body);
  const tasks = (await get(list).expect(200)).body;
  assert.equal(tasks[0].allocationId, tasks[1].allocationId);
  const path = (id: string) =>
    `${base}/cutting/orders/${primary.workOrderId}/recut-plans/${id}/worksheet`;
  const sheet = worksheetSchema.parse(
    (await post(path(tasks[0].allocationId), { employeeIds }).expect(201)).body,
  );
  assert.deepEqual(
    sheet.snapshot.plan.cuts.map((c) => [
      c.stockItemId,
      c.lengthMm,
      c.items.length,
    ]),
    [
      [a, 1000, 1],
      [b, 1000, 2],
    ],
  );
  const storedId = sheet.snapshot.requirements.find(
    (r) => r.quantity === 2,
  )!.id;
  assert.deepEqual(
    sheet.snapshot.plan.cuts[1]!.items.map((i) => i.requirementId === storedId),
    [false, true],
  );
  await post(`${base}/recuts/${other}/withdraw`, {
    expectedRevision: 2,
    reason: 'Original usable',
    unusedWorksheet: { id: sheet.id, expectedRevision: sheet.revision },
  }).expect(201);
  const remaining = (await get(list).expect(200)).body.find(
    (r: { id: string }) => r.id === first,
  );
  assert.equal(remaining.stage, 'cutting');
  const revised = worksheetSchema.parse(
    (await post(path(remaining.allocationId), { employeeIds }).expect(201))
      .body,
  );
  assert.deepEqual(
    revised.snapshot.requirements.map((r) => r.quantity),
    [2],
  );
  assert.ok(
    revised.snapshot.items.every(
      (i) => i.stockItemId === a || i.stockItemId === b,
    ),
  );
});
