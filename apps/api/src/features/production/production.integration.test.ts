import { historySchema } from '@roller-bay/shared/audit';
import { worksheetSchema } from '@roller-bay/shared/production';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import 'reflect-metadata';
import request from 'supertest';
import { DatabaseService } from '../../database/database.service.js';
import { AllocationsService } from '../allocations/index.js';
import { startAllocationsApp } from '../allocations/testing/index.js';
import { AuditService } from '../audit/index.js';

test(
  'station production and digital cutting',
  { timeout: 120_000 },
  async (t) => {
    const h = await startAllocationsApp(t);
    const {
      get,
      post,
      create,
      input,
      seed,
      fixtures,
      userId,
      pool,
      server,
      cookie,
      origin,
      ids,
    } = h;
    const patch = (url: string, body: object) =>
      request(server)
        .patch(url)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .send(body);
    const put = (url: string, body: object) =>
      request(server)
        .put(url)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .send(body);
    const role = async (
      value: 'admin' | 'staff' | 'production',
      stations: string[] = [],
    ) => {
      await pool.query(
        'UPDATE users SET role=$1,stations=$2::jsonb WHERE id=$3',
        [value, JSON.stringify(stations), userId],
      );
    };
    await role('admin');
    const employee = (
      await post('/api/employees', {
        name: 'Alex Reed',
        initials: ' ar ',
      }).expect(201)
    ).body;
    const other = (
      await post('/api/employees', {
        name: 'Avery Ross',
        initials: 'AR',
      }).expect(201)
    ).body;
    assert.notEqual(employee.id, other.id);
    assert.equal(employee.initials, 'AR');
    const order = await create(await input(await seed()));
    await t.test(
      'production account has narrow server permissions and live station assignments',
      async () => {
        await role('production', ['assembly']);
        await get('/api/auth/me').expect(200);
        await get('/api/production/employees').expect(200);
        await get('/api/production/assembly/orders').expect(200);
        await get('/api/production/shipping/orders').expect(403);
        for (const path of [
          '/api/work-orders',
          '/api/stock-items',
          '/api/allocations',
          '/api/employees',
          '/api/users',
          '/api/fabric-catalog/colors',
          '/api/locations',
          '/api/production/cutting/worksheets',
        ])
          await get(path).expect(403);
        await post('/api/work-orders', {
          orderNumber: '789000',
          quantity: 1,
        }).expect(403);
        await post(`/api/allocations/${order.id}/complete`, {}).expect(403);
        await post('/api/employees', {
          name: 'Imposter',
          initials: 'XX',
        }).expect(403);
        await post(
          `/api/production/shipping/orders/${order.workOrderId}/complete`,
          { employeeIds: [employee.id] },
        ).expect(403);
        await request(server)
          .post(`/api/production/assembly/orders/${order.workOrderId}/complete`)
          .set('Cookie', cookie)
          .send({ employeeIds: [employee.id] })
          .expect(403);
        await role('production', []);
        await get('/api/production/assembly/orders').expect(403);
        await role('production', ['assembly']);
      },
    );
    await t.test(
      'independent whole-order milestones retain actor, employee, time, and exact retries',
      async () => {
        const path = `/api/production/assembly/orders/${order.workOrderId}/complete`;
        const key = randomUUID();
        const replies = await Promise.all([
          post(path, { employeeIds: [employee.id] }, key),
          post(path, { employeeIds: [employee.id] }, key),
        ]);
        assert.deepEqual(
          replies.map((r) => r.status),
          [201, 201],
        );
        assert.deepEqual(replies[0]!.body, replies[1]!.body);
        const [completion] = (
          await get(
            `/api/production/orders/${order.workOrderId}/completions`,
          ).expect(200)
        ).body;
        assert.deepEqual(completion.employees, [
          {
            employeeId: employee.id,
            employeeName: 'Alex Reed',
            employeeInitials: 'AR',
          },
        ]);
        assert.equal(completion.recordedByUserId, userId);
        await post(path, { employeeIds: [other.id] }, key).expect(409);
        await post(path, { employeeIds: [other.id] }).expect(409);
        await post(path, { employeeIds: [employee.id] }).expect(201);
        const row = await fixtures.workOrder(order.workOrderId);
        assert.equal(row.cut_at, null);
        assert.equal(row.ship_date, null);
        assert.ok(row.assembled_at);
        const unallocated = await fixtures.createWorkOrder('999001');
        await post(
          `/api/production/assembly/orders/${unallocated.id}/complete`,
          { employeeIds: [employee.id] },
        ).expect(409);
        await role('admin');
        const saved = (
          await get(`/api/work-orders/${order.workOrderId}`).expect(200)
        ).body;
        assert.equal(saved.status, 'assembled');
        assert.equal(
          (await get('/api/work-orders?status=assembled').expect(200)).body
            .items.length,
          1,
        );
        assert.equal(
          (await get('/api/work-orders?status=allocated').expect(200)).body
            .items.length,
          0,
        );
        await patch(`/api/work-orders/${order.workOrderId}`, {
          expectedRevision: saved.revision,
          shipped: true,
        }).expect(400);
        await post(
          `/api/production/shipping/orders/${order.workOrderId}/complete`,
          { employeeIds: [other.id] },
        ).expect(201);
        await post(
          `/api/production/cutting/orders/${order.workOrderId}/complete`,
          { employeeIds: [employee.id] },
        ).expect(201);
        assert.equal(
          (await get(`/api/work-orders/${order.workOrderId}`).expect(200)).body
            .status,
          'shipped',
        );
        await post(`/api/allocations/${order.id}/cancel`, {
          expectedRevision: order.revision,
        }).expect(409);
        await h
          .put(order.id, {
            expectedRevision: order.revision,
            plan: {
              cuts: order.plan.cuts.map((c) => ({
                stockItemId: c.stockItemId,
                items: c.items,
              })),
            },
          })
          .expect(409);
        await put(`/api/employees/${employee.id}`, {
          ...employee,
          name: 'Alex Renamed',
          expectedRevision: employee.revision,
        }).expect(400); // strict input rejects identity fields
        await put(`/api/employees/${employee.id}`, {
          name: 'Alex Renamed',
          initials: 'AN',
          isActive: false,
          linkedUserId: null,
          expectedRevision: employee.revision,
        }).expect(200);
        const current = (
          await get(`/api/work-orders/${order.workOrderId}`).expect(200)
        ).body;
        const correction = {
          expectedRevision: current.revision,
          employeeIds: [other.id],
          completedAt: new Date(Date.now() - 60_000).toISOString(),
          reason: 'Wrong initials selected',
        };
        const correctionKey = randomUUID();
        const correctionPath = `/api/production/assembly/orders/${order.workOrderId}/corrections`;
        await post(correctionPath, correction, correctionKey).expect(201);
        await post(correctionPath, correction, correctionKey).expect(201);
        await post(correctionPath, correction).expect(409);
        const history = historySchema.parse(
          (
            await get(`/api/work-orders/${order.workOrderId}/history`).expect(
              200,
            )
          ).body,
        );
        const original = history.items.find(
          (e) => e.action === 'order.assembly.completed',
        )!;
        const credited = original.changes.find(
          (c) => c.after?.type === 'production',
        )!.after!;
        assert.equal(credited.type, 'production');
        if (credited.type === 'production')
          assert.equal(credited.value.employees[0]!.employeeName, 'Alex Reed');
        const fresh = await create(await input(await seed()));
        await post(
          `/api/production/cutting/orders/${fresh.workOrderId}/complete`,
          { employeeIds: [employee.id] },
        ).expect(409);
      },
    );
    await t.test(
      'several employees share a milestone and only the same set repeats safely',
      async () => {
        await role('admin');
        const third = (
          await post('/api/employees', {
            name: 'Sam Lee',
            initials: 'SL',
          }).expect(201)
        ).body;
        const fresh = await create(await input(await seed()));
        const path = `/api/production/checking/orders/${fresh.workOrderId}/complete`;
        await post(path, { employeeIds: [] }).expect(400);
        await post(path, { employeeIds: [other.id, other.id] }).expect(400);
        await post(path, { employeeIds: [other.id, randomUUID()] }).expect(409);
        // The first subtest deactivated Alex; the refusal names the person.
        assert.match(
          (
            await post(path, { employeeIds: [other.id, employee.id] }).expect(
              409,
            )
          ).body.message,
          /Alex Renamed is no longer active/,
        );
        const key = randomUUID();
        const first = (
          await post(path, { employeeIds: [third.id, other.id] }, key).expect(
            201,
          )
        ).body;
        // The same key with the ids in another order is the same request.
        assert.deepEqual(
          (
            await post(path, { employeeIds: [other.id, third.id] }, key).expect(
              201,
            )
          ).body,
          first,
        );
        const [completion] = (
          await get(
            `/api/production/orders/${fresh.workOrderId}/completions`,
          ).expect(200)
        ).body;
        assert.deepEqual(
          completion.employees.map(
            (e: { employeeName: string }) => e.employeeName,
          ),
          ['Avery Ross', 'Sam Lee'],
        );
        await post(path, { employeeIds: [other.id, third.id] }).expect(201);
        await post(path, { employeeIds: [other.id] }).expect(409);
        await post(path, {
          employeeIds: [other.id, third.id, randomUUID()],
        }).expect(409);
        const current = (
          await get(`/api/work-orders/${fresh.workOrderId}`).expect(200)
        ).body;
        await post(
          `/api/production/checking/orders/${fresh.workOrderId}/corrections`,
          {
            expectedRevision: current.revision,
            employeeIds: [third.id],
            completedAt: completion.completedAt,
            reason: 'Avery worked on another order',
          },
        ).expect(201);
        const history = historySchema.parse(
          (
            await get(`/api/work-orders/${fresh.workOrderId}/history`).expect(
              200,
            )
          ).body,
        );
        assert.ok(
          history.items.some(
            (e) => e.action === 'order.checking.completion-confirmed',
          ),
        );
        const corrected = history.items
          .find((e) => e.action === 'order.checking.corrected')!
          .changes.find((c) => c.recordType === 'production')!;
        assert.equal(
          corrected.before?.type === 'production' &&
            corrected.before.value.employees.length,
          2,
        );
        assert.deepEqual(
          corrected.after?.type === 'production' &&
            corrected.after.value.employees.map((e) => e.employeeId),
          [third.id],
        );
        // Snapshots recorded before milestones could credit several employees
        // still read as one-employee lists.
        const legacy = await pool.query(
          `INSERT INTO audit_events (actor_id,actor_name,action) VALUES ($1,'Legacy','order.assembly.completed') RETURNING id`,
          [userId],
        );
        await pool.query(
          `INSERT INTO audit_changes (event_id,position,record_type,record_id,before,after) VALUES ($1,0,'production',$2,NULL,$3)`,
          [
            legacy.rows[0].id,
            fresh.workOrderId,
            {
              type: 'production',
              value: {
                workOrderId: fresh.workOrderId,
                station: 'assembly',
                employeeId: other.id,
                employeeName: 'Avery Ross',
                employeeInitials: 'AR',
                completedAt: completion.completedAt,
                recordedAt: completion.completedAt,
                recordedByUserId: userId,
              },
            },
          ],
        );
        const replayed = historySchema
          .parse(
            (
              await get(`/api/work-orders/${fresh.workOrderId}/history`).expect(
                200,
              )
            ).body,
          )
          .items.find((e) => e.action === 'order.assembly.completed')!
          .changes[0]!.after!;
        assert.deepEqual(
          replayed.type === 'production' && replayed.value.employees,
          [
            {
              employeeId: other.id,
              employeeName: 'Avery Ross',
              employeeInitials: 'AR',
            },
          ],
        );
      },
    );
    await t.test(
      'cutting sheets preserve plans, draft measurements, milestones and chronological inventory review',
      async () => {
        const stock = await seed(10000);
        const first = await create(await input(stock, 1000));
        const second = await create(await input(stock, 1000));
        await role('admin');
        const signoffEmployee = (
          await post('/api/employees', {
            name: 'Manual Cutter',
            initials: 'MC',
          }).expect(201)
        ).body;
        await role('production', ['cutting']);
        const begin = (id: string) =>
          post(`/api/production/cutting/orders/${id}/worksheet`, {
            employeeId: other.id,
          });
        const current = (id: string) =>
          get(`/api/production/cutting/orders/${id}/worksheet`);
        // No live sheet is an explicit 204; a bare null would be an empty 200.
        assert.equal((await current(first.workOrderId).expect(204)).text, '');
        const sheet = worksheetSchema.parse(
          (await begin(first.workOrderId).expect(201)).body,
        );
        assert.equal(
          worksheetSchema.parse(
            (await current(first.workOrderId).expect(200)).body,
          ).id,
          sheet.id,
        );
        assert.equal(
          (await begin(first.workOrderId).expect(201)).body.id,
          sheet.id,
        );
        await begin(second.workOrderId).expect(409);
        const draft = {
          form: {
            items: [
              {
                stockItemId: stock,
                expectedRevision: 1,
                outcome: 'returned-roll',
                tube: '50',
                depth: '10',
                width: '1200',
                length: '',
                locationId: ids.location,
                scraps: [],
              },
            ],
          },
          units: (await get('/api/auth/me')).body.measurementUnits,
          checkedCuts: [0],
        };
        const saved = worksheetSchema.parse(
          (
            await put(`/api/production/cutting/worksheets/${sheet.id}/draft`, {
              expectedRevision: sheet.revision,
              draft,
            }).expect(200)
          ).body,
        );
        await put(`/api/production/cutting/worksheets/${sheet.id}/draft`, {
          expectedRevision: sheet.revision,
          draft,
        }).expect(200);
        await put(`/api/production/cutting/worksheets/${sheet.id}/draft`, {
          expectedRevision: sheet.revision,
          draft: { ...draft, checkedCuts: [] },
        }).expect(409);
        assert.equal(
          (await fixtures.workOrder(first.workOrderId)).cut_at,
          null,
        );
        const results = {
          expectedRevision: first.revision,
          items: [
            {
              stockItemId: stock,
              expectedRevision: 1,
              outcome: 'returned-roll',
              radialDepthMm: 10,
              tubeOuterDiameterMm: 50,
              locationId: ids.location,
              scraps: [
                {
                  widthMm: 100,
                  lengthMm: 100,
                  quantity: 1,
                  locationId: ids.location,
                },
              ],
            },
          ],
        };
        const submit = (id: string, revision: number, body: object) =>
          post(`/api/production/cutting/worksheets/${id}/submit`, {
            employeeIds: [other.id],
            expectedRevision: revision,
            results: body,
          });
        await post(
          `/api/production/cutting/orders/${first.workOrderId}/complete`,
          { employeeIds: [signoffEmployee.id] },
        ).expect(201);
        const manualCompletion = (
          await get(`/api/production/orders/${first.workOrderId}/completions`)
        ).body;
        assert.equal(
          (await get(`/api/production/cutting/worksheets/${sheet.id}`)).body
            .submittedAt,
          null,
        );
        assert.deepEqual(
          (await get(`/api/production/cutting/worksheets/${sheet.id}`)).body
            .draft,
          saved.draft,
        );
        const submitted = worksheetSchema.parse(
          (await submit(sheet.id, saved.revision, results).expect(201)).body,
        );
        assert.deepEqual(
          (await get(`/api/production/orders/${first.workOrderId}/completions`))
            .body,
          manualCompletion,
        );
        await submit(sheet.id, saved.revision, results).expect(201);
        const cutAt = (await fixtures.workOrder(first.workOrderId)).cut_at;
        assert.ok(cutAt);
        assert.equal(
          Number(
            (
              await pool.query(
                'SELECT revision FROM fabric_stock_items WHERE id=$1',
                [stock],
              )
            ).rows[0].revision,
          ),
          1,
        );
        await post(`/api/production/cutting/worksheets/${sheet.id}/review`, {
          expectedRevision: submitted.revision,
        }).expect(403);
        const next = worksheetSchema.parse(
          (await begin(second.workOrderId).expect(201)).body,
        );
        const nextResults = {
          expectedRevision: second.revision,
          items: [{ ...results.items[0]!, radialDepthMm: 8, scraps: [] }],
        };
        const submittedNext = worksheetSchema.parse(
          (await submit(next.id, next.revision, nextResults).expect(201)).body,
        );
        await role('admin');
        await h
          .put(first.id, {
            expectedRevision: first.revision,
            plan: {
              cuts: first.plan.cuts.map((c) => ({
                stockItemId: c.stockItemId,
                items: c.items,
              })),
            },
          })
          .expect(409);
        await post(`/api/allocations/${first.id}/complete`, results).expect(
          409,
        );
        await post(`/api/production/cutting/worksheets/${next.id}/review`, {
          expectedRevision: submittedNext.revision,
        }).expect(409);
        const reviewKey = randomUUID();
        const review = () =>
          post(
            `/api/production/cutting/worksheets/${sheet.id}/review`,
            {
              expectedRevision: submitted.revision,
            },
            reviewKey,
          );
        const reviewed = await Promise.all([review(), review()]);
        assert.deepEqual(
          reviewed.map((r) => r.status),
          [201, 201],
        );
        assert.deepEqual(
          (await fixtures.workOrder(first.workOrderId)).cut_at,
          cutAt,
        );
        await post(`/api/production/cutting/worksheets/${next.id}/review`, {
          expectedRevision: submittedNext.revision,
        }).expect(201);
        const balance = Number(
          (
            await pool.query(
              'SELECT remaining_length_mm FROM fabric_stock_items WHERE id=$1',
              [stock],
            )
          ).rows[0].remaining_length_mm,
        );
        assert.ok(balance > 0);
        assert.ok((await fixtures.workOrder(second.workOrderId)).cut_at);
        const historical = worksheetSchema.parse(
          (
            await get(`/api/production/cutting/worksheets/${sheet.id}`).expect(
              200,
            )
          ).body,
        );
        assert.equal(historical.snapshot.items[0]!.stockItem.revision, 1);
        assert.equal(historical.snapshot.revision, first.revision);
        assert.ok(historical.reviewedAt);
        assert.equal(
          Number(
            (
              await pool.query(
                'SELECT count(*) FROM fabric_stock_items WHERE source_stock_item_id=$1',
                [stock],
              )
            ).rows[0].count,
          ),
          1,
        );
      },
    );
    await t.test(
      'manual cutting and worksheet submission are atomic and preserve corrections',
      async () => {
        await role('admin');
        const manual = await create(await input(await seed()));
        await post(
          `/api/production/cutting/orders/${manual.workOrderId}/complete`,
          { employeeIds: [other.id] },
        ).expect(201);
        assert.ok((await fixtures.workOrder(manual.workOrderId)).cut_at);
        await post(
          `/api/production/cutting/orders/${manual.workOrderId}/worksheet`,
          { employeeId: other.id },
        ).expect(409);
        const allocation = await create(await input(await seed()));
        const sheet = (
          await post(
            `/api/production/cutting/orders/${allocation.workOrderId}/worksheet`,
            { employeeId: other.id },
          ).expect(201)
        ).body;
        const path = `/api/production/cutting/worksheets/${sheet.id}/submit`;
        const helper = (
          await post('/api/employees', {
            name: 'Second Cutter',
            initials: 'SC',
          }).expect(201)
        ).body;
        const body = {
          expectedRevision: sheet.revision,
          employeeIds: [other.id, helper.id],
          results: {
            expectedRevision: allocation.revision,
            items: [
              {
                stockItemId: allocation.items[0]!.stockItemId,
                expectedRevision: 1,
                outcome: 'returned-roll',
                radialDepthMm: 10,
                tubeOuterDiameterMm: 50,
                locationId: ids.location,
                scraps: [],
              },
            ],
          },
        };
        await post(path, { ...body, employeeIds: [] }).expect(400);
        await post(path, { ...body, employeeIds: [randomUUID()] }).expect(409);
        assert.equal(
          (await get(`/api/production/cutting/worksheets/${sheet.id}`)).body
            .submittedAt,
          null,
        );
        const audit = h.app.get(AuditService);
        const original = audit.record;
        const failure = t.mock.method(
          audit,
          'record',
          (...args: Parameters<AuditService['record']>) => {
            if (args[2] === 'order.cutting.completed')
              throw new Error('Simulated completion audit failure');
            return original.apply(audit, args);
          },
        );
        try {
          await post(path, body).expect(503);
        } finally {
          failure.mock.restore();
        }
        assert.equal(
          (await fixtures.workOrder(allocation.workOrderId)).cut_at,
          null,
        );
        assert.equal(
          (await get(`/api/production/cutting/worksheets/${sheet.id}`)).body
            .results,
          null,
        );
        assert.deepEqual(
          (
            await get(
              `/api/production/orders/${allocation.workOrderId}/completions`,
            )
          ).body,
          [],
        );
        const submissions = await Promise.all([
          post(path, body),
          post(path, body),
        ]);
        assert.deepEqual(
          submissions.map((r) => r.status),
          [201, 201],
        );
        const submitted = submissions[0]!.body;
        const completionPath = `/api/production/orders/${allocation.workOrderId}/completions`;
        const completed = (await get(completionPath)).body;
        assert.equal(completed[0].completedAt, submitted.submittedAt);
        assert.deepEqual(
          completed[0].employees
            .map((e: { employeeId: string }) => e.employeeId)
            .sort(),
          [other.id, helper.id].sort(),
        );
        const history = (
          await get(`/api/work-orders/${allocation.workOrderId}/history`)
        ).body;
        assert.equal(
          history.items.filter(
            (e: { action: string }) => e.action === 'order.cutting.completed',
          ).length,
          1,
        );
        const returned = (
          await post(`/api/production/cutting/worksheets/${sheet.id}/return`, {
            expectedRevision: submitted.revision,
            reason: 'Confirm measurements',
          }).expect(201)
        ).body;
        assert.deepEqual((await get(completionPath)).body, completed);
        const resubmitted = (
          await post(path, {
            ...body,
            expectedRevision: returned.revision,
          }).expect(201)
        ).body;
        assert.deepEqual((await get(completionPath)).body, completed);
        const returnedAgain = (
          await post(`/api/production/cutting/worksheets/${sheet.id}/return`, {
            expectedRevision: resubmitted.revision,
            reason: 'Correct erroneous cutting record',
          }).expect(201)
        ).body;
        const order = (await get(`/api/work-orders/${allocation.workOrderId}`))
          .body;
        await post(`/api/production/cutting/orders/${order.id}/corrections`, {
          expectedRevision: order.revision,
          employeeIds: null,
          completedAt: null,
          reason: 'Recorded in error',
        }).expect(201);
        await post(path, {
          ...body,
          expectedRevision: returnedAgain.revision,
        }).expect(201);
        assert.equal((await fixtures.workOrder(order.id)).cut_at, null);
      },
    );
    await t.test(
      'regression: a cleared cut can be recorded manually after a previous worksheet submission',
      async () => {
        await role('admin');
        for (const state of ['submitted', 'returned', 'reviewed']) {
          const allocation = await create(await input(await seed()));
          const orderId = allocation.workOrderId;
          const queueOrder = async () => {
            const order = (await get(`/api/work-orders/${orderId}`).expect(200))
              .body;
            const queue = (
              await get(
                `/api/production/cutting/orders?search=${order.orderNumber}`,
              ).expect(200)
            ).body;
            return queue.items.find(
              (item: { id: string }) => item.id === orderId,
            );
          };
          const sheet = (
            await post(`/api/production/cutting/orders/${orderId}/worksheet`, {
              employeeId: other.id,
            }).expect(201)
          ).body;
          assert.equal((await queueOrder()).hasCuttingWorksheet, true);
          let saved = (
            await post(
              `/api/production/cutting/worksheets/${sheet.id}/submit`,
              {
                employeeIds: [other.id],
                expectedRevision: sheet.revision,
                results: {
                  expectedRevision: allocation.revision,
                  items: [
                    {
                      stockItemId: allocation.items[0]!.stockItemId,
                      expectedRevision: 1,
                      outcome: 'returned-roll',
                      radialDepthMm: 10,
                      tubeOuterDiameterMm: 50,
                      locationId: ids.location,
                      scraps: [],
                    },
                  ],
                },
              },
            ).expect(201)
          ).body;
          if (state === 'returned')
            saved = (
              await post(
                `/api/production/cutting/worksheets/${sheet.id}/return`,
                {
                  expectedRevision: saved.revision,
                  reason: 'Check measurement',
                },
              ).expect(201)
            ).body;
          if (state === 'reviewed')
            saved = (
              await post(
                `/api/production/cutting/worksheets/${sheet.id}/review`,
                {
                  expectedRevision: saved.revision,
                },
              ).expect(201)
            ).body;
          const order = (await get(`/api/work-orders/${orderId}`)).body;
          await post(`/api/production/cutting/orders/${orderId}/corrections`, {
            expectedRevision: order.revision,
            employeeIds: null,
            completedAt: null,
            reason: 'Remove mistaken milestone',
          }).expect(201);
          assert.equal((await queueOrder()).hasCuttingWorksheet, true);
          const stockBefore = (
            await pool.query('SELECT * FROM fabric_stock_items WHERE id=$1', [
              allocation.items[0]!.stockItemId,
            ])
          ).rows;
          await post(`/api/production/cutting/orders/${orderId}/complete`, {
            employeeIds: [other.id],
          }).expect(201);
          assert.ok((await fixtures.workOrder(orderId)).cut_at);
          assert.deepEqual(
            (await get(`/api/production/cutting/worksheets/${sheet.id}`)).body,
            saved,
          );
          assert.deepEqual(
            (
              await pool.query('SELECT * FROM fabric_stock_items WHERE id=$1', [
                allocation.items[0]!.stockItemId,
              ])
            ).rows,
            stockBefore,
          );
        }
      },
    );
    await t.test(
      'unused sheets can be abandoned and external stock revisions cannot silently overwrite inventory',
      async () => {
        const allocation = await create(await input(await seed()));
        const begin = () =>
          post(
            `/api/production/cutting/orders/${allocation.workOrderId}/worksheet`,
            { employeeId: other.id },
          );
        const sheet = (await begin().expect(201)).body;
        await post(`/api/production/cutting/worksheets/${sheet.id}/abandon`, {
          expectedRevision: sheet.revision,
          reason: 'Wrong order selected; no fabric cut',
        }).expect(201);
        await get(
          `/api/production/cutting/orders/${allocation.workOrderId}/worksheet`,
        ).expect(204);
        const fresh = (await begin().expect(201)).body;
        assert.notEqual(fresh.id, sheet.id);
        const stock = allocation.items[0]!.stockItemId;
        const results = {
          expectedRevision: allocation.revision,
          items: [
            {
              stockItemId: stock,
              expectedRevision: 1,
              outcome: 'returned-roll',
              radialDepthMm: 10,
              tubeOuterDiameterMm: 50,
              locationId: ids.location,
              scraps: [],
            },
          ],
        };
        const submitted = (
          await post(`/api/production/cutting/worksheets/${fresh.id}/submit`, {
            employeeIds: [other.id],
            expectedRevision: fresh.revision,
            results,
          }).expect(201)
        ).body;
        await pool.query(
          'UPDATE fabric_stock_items SET revision=revision+1 WHERE id=$1',
          [stock],
        );
        await post(`/api/production/cutting/worksheets/${fresh.id}/review`, {
          expectedRevision: submitted.revision,
        }).expect(409);
        assert.equal(
          (await get(`/api/allocations/${allocation.id}`).expect(200)).body
            .state,
          'active',
        );
        await post(`/api/production/cutting/worksheets/${fresh.id}/review`, {
          expectedRevision: submitted.revision,
          resolution: {
            reason: 'Physically remeasured after correction',
            results: {
              ...results,
              items: [
                { ...results.items[0], expectedRevision: 2, radialDepthMm: 9 },
              ],
            },
          },
        }).expect(201);
        assert.ok((await fixtures.workOrder(allocation.workOrderId)).cut_at);
      },
    );
    await t.test(
      'a successful duplicate retry cannot restore an admin-cleared milestone',
      async () => {
        await role('admin');
        const fresh = await create(await input(await seed()));
        const path = `/api/production/checking/orders/${fresh.workOrderId}/complete`;
        await post(path, { employeeIds: [other.id] }).expect(201);
        const key = randomUUID();
        const duplicate = (
          await post(path, { employeeIds: [other.id] }, key).expect(201)
        ).body;
        const current = (
          await get(`/api/work-orders/${fresh.workOrderId}`).expect(200)
        ).body;
        await post(
          `/api/production/checking/orders/${fresh.workOrderId}/corrections`,
          {
            expectedRevision: current.revision,
            employeeIds: null,
            completedAt: null,
            reason: 'Wrong order scanned',
          },
        ).expect(201);
        assert.deepEqual(
          (await post(path, { employeeIds: [other.id] }, key).expect(201)).body,
          duplicate,
        );
        assert.equal(
          (await fixtures.workOrder(fresh.workOrderId)).checked_at,
          null,
        );
        assert.equal(
          (
            await get(
              `/api/production/orders/${fresh.workOrderId}/completions`,
            ).expect(200)
          ).body.length,
          0,
        );
      },
    );
    await t.test(
      'a final worksheet audit failure rolls back inventory, remnants and both workflow records',
      async () => {
        await role('admin');
        const stock = await seed();
        const allocation = await create(await input(stock));
        const sheet = (
          await post(
            `/api/production/cutting/orders/${allocation.workOrderId}/worksheet`,
            { employeeId: other.id },
          ).expect(201)
        ).body;
        const submitted = (
          await post(`/api/production/cutting/worksheets/${sheet.id}/submit`, {
            employeeIds: [other.id],
            expectedRevision: sheet.revision,
            results: {
              expectedRevision: allocation.revision,
              items: [
                {
                  stockItemId: stock,
                  expectedRevision: 1,
                  outcome: 'returned-roll',
                  radialDepthMm: 10,
                  tubeOuterDiameterMm: 50,
                  locationId: ids.location,
                  scraps: [
                    {
                      widthMm: 100,
                      lengthMm: 100,
                      quantity: 1,
                      locationId: ids.location,
                    },
                  ],
                },
              ],
            },
          }).expect(201)
        ).body;
        const before = (
          await pool.query(
            'SELECT count(*)::int AS count FROM fabric_stock_items',
          )
        ).rows[0].count;
        const audit = h.app.get(AuditService);
        const original = audit.record;
        const failure = t.mock.method(
          audit,
          'record',
          (...args: Parameters<AuditService['record']>) => {
            if (args[2] === 'cutting.reviewed')
              throw new Error('Simulated final worksheet audit failure');
            return original.apply(audit, args);
          },
        );
        const transaction = t.mock.method(
          h.app.get(DatabaseService).db,
          'transaction',
        );
        const completion = t.mock.method(
          h.app.get(AllocationsService),
          'completeInTransaction',
        );
        try {
          await post(`/api/production/cutting/worksheets/${sheet.id}/review`, {
            expectedRevision: submitted.revision,
          }).expect(503);
          assert.equal(transaction.mock.callCount(), 1);
          assert.equal(completion.mock.callCount(), 1);
          const context = completion.mock.calls[0]!.arguments[0];
          assert.ok(
            failure.mock.calls.every((call) => call.arguments[0] === context),
          );
        } finally {
          failure.mock.restore();
          transaction.mock.restore();
          completion.mock.restore();
        }
        const after = (
          await pool.query(
            'SELECT count(*)::int AS count FROM fabric_stock_items',
          )
        ).rows[0].count;
        assert.equal(after, before);
        assert.equal(
          (
            await pool.query(
              'SELECT revision FROM fabric_stock_items WHERE id=$1',
              [stock],
            )
          ).rows[0].revision,
          1,
        );
        assert.equal(
          (await get(`/api/allocations/${allocation.id}`).expect(200)).body
            .state,
          'active',
        );
        const retained = (
          await get(`/api/production/cutting/worksheets/${sheet.id}`).expect(
            200,
          )
        ).body;
        assert.equal(retained.reviewedAt, null);
        assert.equal(retained.revision, submitted.revision);
        await post(`/api/production/cutting/worksheets/${sheet.id}/review`, {
          expectedRevision: submitted.revision,
        }).expect(201);
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS count FROM fabric_stock_items',
            )
          ).rows[0].count,
          before + 1,
        );
      },
    );

    await t.test(
      'a physical resolution breaks revision propagation to older captured successor observations',
      async () => {
        await role('admin');
        const stock = await seed();
        const first = await create(await input(stock));
        const second = await create(await input(stock));
        const begin = async (orderId: string) =>
          (
            await post(`/api/production/cutting/orders/${orderId}/worksheet`, {
              employeeId: other.id,
            }).expect(201)
          ).body;
        const results = (
          revision: number,
          depth: number,
          stockRevision = 1,
        ) => ({
          expectedRevision: revision,
          items: [
            {
              stockItemId: stock,
              expectedRevision: stockRevision,
              outcome: 'returned-roll',
              radialDepthMm: depth,
              tubeOuterDiameterMm: 50,
              locationId: ids.location,
              scraps: [],
            },
          ],
        });
        const a = await begin(first.workOrderId);
        const sa = (
          await post(`/api/production/cutting/worksheets/${a.id}/submit`, {
            employeeIds: [other.id],
            expectedRevision: a.revision,
            results: results(first.revision, 10),
          }).expect(201)
        ).body;
        const b = await begin(second.workOrderId);
        const sb = (
          await post(`/api/production/cutting/worksheets/${b.id}/submit`, {
            employeeIds: [other.id],
            expectedRevision: b.revision,
            results: results(second.revision, 8),
          }).expect(201)
        ).body;
        await pool.query(
          'UPDATE fabric_stock_items SET revision=revision+1 WHERE id=$1',
          [stock],
        );
        const key = randomUUID();
        const path = `/api/production/cutting/worksheets/${a.id}/review`;
        const body = {
          expectedRevision: sa.revision,
          resolution: {
            reason: 'Current physical remeasurement after later work',
            results: results(first.revision, 6, 2),
          },
        };
        const different = {
          ...body,
          resolution: {
            ...body.resolution,
            results: results(first.revision, 9, 2),
          },
        };
        // Competing payloads never both report successful application.
        const concurrent = await Promise.all([
          post(path, body, key),
          post(path, different, key),
        ]);
        assert.deepEqual(
          concurrent.map((reply) => reply.status).sort(),
          [201, 409],
        );
        const accepted = concurrent[0]!.status === 201 ? body : different;
        const declined = concurrent[0]!.status === 201 ? different : body;
        await post(path, accepted, key).expect(201);
        await post(path, declined, key).expect(409);
        await post(path, accepted).expect(409);
        await post(path, { expectedRevision: sa.revision }).expect(409);
        const before = (
          await pool.query(
            'SELECT radial_depth_mm,revision FROM fabric_stock_items WHERE id=$1',
            [stock],
          )
        ).rows[0];
        await post(`/api/production/cutting/worksheets/${b.id}/review`, {
          expectedRevision: sb.revision,
        }).expect(409);
        const after = (
          await pool.query(
            'SELECT radial_depth_mm,revision FROM fabric_stock_items WHERE id=$1',
            [stock],
          )
        ).rows[0];
        assert.deepEqual(after, before);
        await post(`/api/production/cutting/worksheets/${b.id}/review`, {
          expectedRevision: sb.revision,
          resolution: {
            reason: 'Verified current measurement for the remaining sheet',
            results: results(second.revision, 5, before.revision),
          },
        }).expect(201);
        const final = (
          await pool.query(
            'SELECT radial_depth_mm FROM fabric_stock_items WHERE id=$1',
            [stock],
          )
        ).rows[0];
        assert.equal(Number(final.radial_depth_mm), 5);
      },
    );

    await t.test(
      'production and order projections roll back together when completion audit fails',
      async () => {
        await role('admin');
        const allocation = await create(await input(await seed()));
        const before = await fixtures.workOrder(allocation.workOrderId);
        const path = `/api/production/checking/orders/${allocation.workOrderId}/complete`;
        const key = randomUUID();
        const audit = h.app.get(AuditService);
        const original = audit.record;
        const failure = t.mock.method(
          audit,
          'record',
          (...args: Parameters<AuditService['record']>) => {
            if (args[2] === 'order.checking.completed')
              throw new Error('Simulated completion audit failure');
            return original.apply(audit, args);
          },
        );
        try {
          await post(path, { employeeIds: [other.id] }, key).expect(503);
        } finally {
          failure.mock.restore();
        }
        const after = await fixtures.workOrder(allocation.workOrderId);
        assert.equal(after.checked_at, null);
        assert.equal(after.revision, before.revision);
        assert.equal(
          (
            await get(
              `/api/production/orders/${allocation.workOrderId}/completions`,
            ).expect(200)
          ).body.length,
          0,
        );
        await post(path, { employeeIds: [other.id] }, key).expect(201);
        assert.ok(
          (await fixtures.workOrder(allocation.workOrderId)).checked_at,
        );
      },
    );
  },
);
