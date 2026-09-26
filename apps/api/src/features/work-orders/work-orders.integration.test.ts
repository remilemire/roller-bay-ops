import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import request from 'supertest';
import { startSignedInApp } from '../../testing/integration-app.js';
import type { UserRole } from '@roller-bay/shared/users';
import { historySchema } from '@roller-bay/shared/audit';
import {
  workOrderListSchema,
  workOrderSchema,
} from '@roller-bay/shared/work-orders';

test('work orders integration', { timeout: 60_000 }, async (t) => {
  const { app, pool, cookie, userId, origin, fixtures } =
    await startSignedInApp(t);
  const server = app.getHttpServer();
  const path = '/api/work-orders';
  const get = (url: string) => request(server).get(url).set('Cookie', cookie);
  const send = (method: 'post' | 'patch' | 'delete', url: string) =>
    request(server)[method](url).set('Cookie', cookie).set('Origin', origin);
  const post = (body: object) => send('post', path).send(body);
  const patch = (id: string, body: object) =>
    send('patch', `${path}/${id}`).send(body);
  const remove = (id: string, expectedRevision: number) =>
    send('delete', `${path}/${id}`).send({ expectedRevision });
  const role = (value: UserRole) => fixtures.setUserRole(userId, value);
  await t.test(
    'order reads require a session; employees create orders, and the rest takes admin or owner',
    async () => {
      await role('staff');
      await request(server).get(path).expect(401);
      await request(server).get(`${path}/${randomUUID()}`).expect(401);
      await request(server)
        .post(path)
        .set('Origin', origin)
        .send({})
        .expect(401);
      await get(path).expect(200);
      await get(`${path}/${randomUUID()}/history`).expect(200);
      // Whoever allocates an order's fabric may create it, without a note;
      // the note is refused rather than quietly dropped.
      await post({}).expect(400);
      await post({ orderNumber: '200001', quantity: 1, note: 'Rush' }).expect(
        403,
      );
      const order = (
        await post({ orderNumber: '200001', quantity: 1 }).expect(201)
      ).body;
      assert.equal(order.status, 'new');
      await patch(order.id, { expectedRevision: 1, note: 'x' }).expect(403);
      await remove(order.id, 1).expect(403);
      await role('owner');
      for (const untrusted of [undefined, 'https://untrusted.example']) {
        const attempt = request(server)
          .patch(`${path}/${order.id}`)
          .set('Cookie', cookie);
        if (untrusted) attempt.set('Origin', untrusted);
        await attempt.send({ expectedRevision: 1, note: 'x' }).expect(403);
      }
      await remove(order.id, 1).expect(204);
      await role('admin');
    },
  );

  await t.test(
    'work orders validate input, keep a unique number, and check revisions',
    async () => {
      await get(`${path}/invalid`).expect(400);
      await get(`${path}/${randomUUID()}`).expect(404);
      await patch(randomUUID(), { expectedRevision: 1, note: 'x' }).expect(404);
      await remove(randomUUID(), 1).expect(404);
      for (const query of ['page=0', 'pageSize=101', 'status=ready', 'x=1'])
        await get(`${path}?${query}`).expect(400);
      for (const body of [
        { orderNumber: '20001', quantity: 1 },
        // An order states how many blinds it has, and is created without a
        // ship date.
        { orderNumber: '200002' },
        { orderNumber: '200002', quantity: 0 },
        { orderNumber: '200002', quantity: 1.5 },
        { orderNumber: '200002', quantity: 10001 },
        { orderNumber: '200002', quantity: 1, shipDate: '2026-10-02' },
        { orderNumber: '200002', quantity: 1, shippedAt: null },
        { orderNumber: '200002', quantity: 1, note: 'x'.repeat(1001) },
      ])
        await post(body).expect(400);

      const created = workOrderSchema.parse(
        (
          await post({
            orderNumber: ' 200002 ',
            quantity: 12,
            note: '  Rush  ',
          }).expect(201)
        ).body,
      );
      assert.equal(created.orderNumber, '200002');
      assert.equal(created.note, 'Rush');
      assert.equal(created.quantity, 12);
      assert.equal(created.status, 'new');
      assert.equal(created.revision, 1);
      assert.deepEqual(
        [
          created.shipDate,
          created.scheduledAt,
          created.allocatedAt,
          created.cutAt,
          created.shippedAt,
        ],
        [null, null, null, null, null],
      );

      const duplicate = await post({
        orderNumber: '200002',
        quantity: 1,
      }).expect(409);
      assert.deepEqual(duplicate.body.issues, [
        {
          code: 'order_already_exists',
          path: ['orderNumber'],
          message: 'Already exists.',
        },
      ]);
      const concurrent = await Promise.all(
        [1, 2].map(() => post({ orderNumber: '200003', quantity: 1 })),
      );
      assert.deepEqual(concurrent.map((r) => r.status).sort(), [201, 409]);

      // The order number is fixed once created.
      await patch(created.id, {
        expectedRevision: 1,
        orderNumber: '200009',
      }).expect(400);
      await patch(created.id, { expectedRevision: 1 }).expect(400);
      const updated = workOrderSchema.parse(
        (
          await patch(created.id, { expectedRevision: 1, note: ' ' }).expect(
            200,
          )
        ).body,
      );
      assert.equal(updated.note, null);
      assert.equal(updated.revision, 2);
      await patch(created.id, { expectedRevision: 2, quantity: 0 }).expect(400);
      const recounted = workOrderSchema.parse(
        (
          await patch(created.id, { expectedRevision: 2, quantity: 14 }).expect(
            200,
          )
        ).body,
      );
      assert.equal(recounted.quantity, 14);
      assert.equal(recounted.revision, 3);
      await patch(created.id, { expectedRevision: 1, note: 'stale' }).expect(
        409,
      );
      await remove(created.id, 1).expect(409);

      // The allocation's blinds were checked against the quantity, so it is
      // fixed while the order has one; sending it unchanged is accepted.
      await pool.query(
        `UPDATE work_orders SET allocated_at=now() WHERE id=$1`,
        [created.id],
      );
      const fixed = await patch(created.id, {
        expectedRevision: 3,
        quantity: 15,
      }).expect(409);
      assert.deepEqual(fixed.body.issues, [
        {
          code: 'order_allocated',
          path: ['quantity'],
          message: 'Fixed while the order has an allocation.',
        },
      ]);
      await patch(created.id, { expectedRevision: 3, quantity: 14 }).expect(
        200,
      );
    },
  );

  await t.test(
    'an order is scheduled only once it is allocated, on a weekday, and can be taken off the schedule',
    async () => {
      const order = workOrderSchema.parse(
        (await post({ orderNumber: '200010', quantity: 1 }).expect(201)).body,
      );
      const early = await patch(order.id, {
        expectedRevision: 1,
        shipDate: '2026-10-09',
      }).expect(409);
      assert.deepEqual(early.body.issues, [
        {
          code: 'order_not_allocated',
          path: ['shipDate'],
          message: 'Allocate fabric or enter back-order details first.',
        },
      ]);
      // Allocating is the allocation suites' subject; this order only needs
      // to have been allocated.
      await pool.query(
        `UPDATE work_orders SET allocated_at=now() WHERE id=$1`,
        [order.id],
      );

      const weekend = await patch(order.id, {
        expectedRevision: 1,
        shipDate: '2026-10-10',
      }).expect(400);
      assert.deepEqual(weekend.body.issues[0].path, ['shipDate']);
      assert.equal(weekend.body.issues[0].message, 'Must be a weekday.');
      const scheduled = workOrderSchema.parse(
        (
          await patch(order.id, {
            expectedRevision: 1,
            shipDate: '2026-10-09',
          }).expect(200)
        ).body,
      );
      assert.equal(scheduled.status, 'scheduled');
      assert.equal(scheduled.shipDate, '2026-10-09');
      assert.ok(scheduled.scheduledAt);
      for (const shipDate of ['2026-10-03', '2026-10-04'])
        await assert.rejects(
          pool.query(`UPDATE work_orders SET ship_date=$1 WHERE id=$2`, [
            shipDate,
            order.id,
          ]),
          { code: '23514', constraint: 'work_orders_ship_date_weekday' },
        );
      await assert.rejects(
        pool.query(`UPDATE work_orders SET scheduled_at=NULL WHERE id=$1`, [
          order.id,
        ]),
        {
          code: '23514',
          constraint: 'work_orders_scheduled_at_matches_ship_date',
        },
      );
      // Moving the date keeps the time the order went on the schedule.
      const moved = workOrderSchema.parse(
        (
          await patch(order.id, {
            expectedRevision: 2,
            shipDate: '2026-10-12',
          }).expect(200)
        ).body,
      );
      assert.equal(moved.scheduledAt, scheduled.scheduledAt);

      // Clearing the date changes nothing else.
      const cleared = workOrderSchema.parse(
        (
          await patch(order.id, { expectedRevision: 3, shipDate: null }).expect(
            200,
          )
        ).body,
      );
      assert.deepEqual(cleared, {
        ...moved,
        shipDate: null,
        scheduledAt: null,
        status: 'allocated',
        revision: 4,
        updatedAt: cleared.updatedAt,
      });
      await patch(order.id, {
        expectedRevision: 4,
        shipDate: '2026-10-09',
      }).expect(200);

      // Production now requires an attributed station write.
      await patch(order.id, { expectedRevision: 5, shipped: true }).expect(400);
      await patch(order.id, { expectedRevision: 5, shipped: false }).expect(
        400,
      );

      const history = historySchema.parse(
        (await get(`${path}/${order.id}/history`).expect(200)).body,
      );
      assert.deepEqual(history.items.map((event) => event.action).sort(), [
        'order.created',
        'order.scheduled',
        'order.scheduled',
        'order.unscheduled',
        'order.updated',
      ]);
      assert.ok(
        history.items.every((event) =>
          event.changes.every((c) => c.recordType === 'work-orders'),
        ),
      );
    },
  );

  await t.test(
    'a back order schedules an unallocated order on its purchase orders, and stays once allocated',
    async () => {
      const backOrder = { purchaseOrderNumbers: ['43150', '43142'] };
      const listed = { purchaseOrderNumbers: ['43142', '43150'] };
      const issues = (response: request.Response) =>
        response.body.issues.map(
          (issue: { code: string; path: string[] }) =>
            `${issue.code}@${issue.path.join('.')}`,
        );
      // A new order may be back-ordered and dated at once, by an admin.
      await role('staff');
      await post({ orderNumber: '200040', quantity: 1, backOrder }).expect(403);
      await role('admin');
      const created = workOrderSchema.parse(
        (
          await post({
            orderNumber: '200040',
            quantity: 1,
            backOrder,
            shipDate: '2026-10-12',
          }).expect(201)
        ).body,
      );
      assert.equal(created.status, 'scheduled');
      assert.deepEqual(created.backOrder, listed);
      assert.ok(created.scheduledAt);
      for (const purchaseOrderNumbers of [[], ['43142', '43142'], ['4314']])
        await post({
          orderNumber: '200041',
          quantity: 1,
          backOrder: { purchaseOrderNumbers },
        }).expect(400);

      // An undated back order waits in the queue to be scheduled.
      const order = workOrderSchema.parse(
        (await post({ orderNumber: '200042', quantity: 1 }).expect(201)).body,
      );
      const queued = async () =>
        workOrderListSchema
          .parse(
            (await get(`${path}?status=unscheduled&search=200042`).expect(200))
              .body,
          )
          .items.map((item) => item.orderNumber);
      assert.deepEqual(await queued(), []);
      const backOrdered = workOrderSchema.parse(
        (await patch(order.id, { expectedRevision: 1, backOrder }).expect(200))
          .body,
      );
      assert.equal(backOrdered.status, 'new');
      assert.deepEqual(backOrdered.backOrder, listed);
      assert.deepEqual(await queued(), ['200042']);
      await patch(order.id, {
        expectedRevision: 2,
        shipDate: '2026-10-12',
      }).expect(200);
      // Its purchase orders can change, but a dated order keeps a source of
      // fabric.
      const changed = workOrderSchema.parse(
        (
          await patch(order.id, {
            expectedRevision: 3,
            backOrder: { purchaseOrderNumbers: ['43199'] },
          }).expect(200)
        ).body,
      );
      assert.deepEqual(changed.backOrder, { purchaseOrderNumbers: ['43199'] });
      const stranded = await patch(order.id, {
        expectedRevision: 4,
        backOrder: null,
      }).expect(409);
      assert.deepEqual(issues(stranded), ['back_order_required@backOrder']);
      await patch(order.id, { expectedRevision: 4, note: 'Due' }).expect(200);

      // Once allocated, the back order stays as a record.
      await pool.query(
        `UPDATE work_orders SET allocated_at=now() WHERE id=$1`,
        [order.id],
      );
      const unscheduled = workOrderSchema.parse(
        (
          await patch(order.id, { expectedRevision: 5, shipDate: null }).expect(
            200,
          )
        ).body,
      );
      assert.deepEqual(unscheduled.backOrder, {
        purchaseOrderNumbers: ['43199'],
      });
      assert.equal(
        workOrderSchema.parse(
          (
            await patch(order.id, {
              expectedRevision: 6,
              backOrder: null,
            }).expect(200)
          ).body,
        ).backOrder,
        null,
      );
      await assert.rejects(
        pool.query(
          `INSERT INTO work_order_purchase_orders (work_order_id, purchase_order_number) VALUES ($1, '4314')`,
          [order.id],
        ),
        {
          code: '23514',
          constraint: 'work_order_purchase_orders_number_format',
        },
      );
    },
  );

  await t.test(
    'a deleted order is kept out of sight, and creating its number again restores it',
    async () => {
      const created = workOrderSchema.parse(
        (
          await post({
            orderNumber: '200020',
            quantity: 4,
            note: 'Rush',
          }).expect(201)
        ).body,
      );
      await remove(created.id, 1).expect(204);
      await get(`${path}/${created.id}`).expect(404);
      const deleted = historySchema.parse(
        (await get(`${path}/${created.id}/history`).expect(200)).body,
      );
      assert.equal(deleted.items[0]!.action, 'order.deleted');
      assert.equal(deleted.items[0]!.changes[0]!.after, null);

      // The order is kept, out of sight: allocations reference its number.
      assert.deepEqual(
        workOrderListSchema
          .parse((await get(`${path}?search=200020`).expect(200)).body)
          .items.map((order) => order.orderNumber),
        [],
      );
      await patch(created.id, { expectedRevision: 2, note: 'gone' }).expect(
        404,
      );
      await remove(created.id, 2).expect(404);
      const kept = await pool.query(
        `SELECT deleted_at FROM work_orders WHERE id=$1`,
        [created.id],
      );
      assert.ok(kept.rows[0].deleted_at);

      // Creating the number again restores that order with the new details.
      const restored = workOrderSchema.parse(
        (await post({ orderNumber: '200020', quantity: 6 }).expect(201)).body,
      );
      assert.equal(restored.id, created.id);
      assert.equal(restored.note, null);
      assert.equal(restored.quantity, 6);
      assert.equal(restored.status, 'new');
      assert.equal(restored.revision, 3);
      assert.equal(restored.createdAt, created.createdAt);
      const history = historySchema.parse(
        (await get(`${path}/${created.id}/history`).expect(200)).body,
      );
      assert.equal(history.items[0]!.action, 'order.restored');
      assert.equal(history.items[0]!.changes[0]!.before, null);
      // Once restored it is an ordinary order again.
      await post({ orderNumber: '200020', quantity: 1 }).expect(409);
    },
  );

  await t.test(
    'orders list by ship date, undated last, and filter by derived status, queue and literal search',
    async () => {
      await pool.query(`DELETE FROM work_orders`);
      const at = '2026-09-01T12:00:00Z';
      // [order number, ship date, allocated, cut, shipped]
      const rows: [string, string | null, boolean, boolean, boolean][] = [
        ['210004', null, false, false, false],
        ['210003', '2026-10-05', true, false, false],
        ['210006', null, true, false, false],
        ['210002', '2026-10-02', true, true, false],
        ['210007', null, true, true, false],
        ['210001', '2026-10-01', true, true, true],
        // Shipping is not gated on the earlier steps.
        ['210005', null, false, false, true],
      ];
      for (const [orderNumber, shipDate, allocated, cut, shipped] of rows)
        await pool.query(
          `INSERT INTO work_orders
               (order_number, quantity, ship_date, scheduled_at, allocated_at, cut_at, shipped_at)
             VALUES ($1, 1, $2, $3, $4, $5, $6)`,
          [
            orderNumber,
            shipDate,
            shipDate ? at : null,
            allocated ? at : null,
            cut ? at : null,
            shipped ? at : null,
          ],
        );
      const numbers = async (query: string) =>
        workOrderListSchema
          .parse((await get(`${path}?${query}`).expect(200)).body)
          .items.map((order) => order.orderNumber);
      assert.deepEqual(await numbers(''), [
        '210001',
        '210002',
        '210003',
        '210004',
        '210005',
        '210006',
        '210007',
      ]);
      assert.deepEqual(await numbers('status=open'), [
        '210002',
        '210003',
        '210004',
        '210006',
        '210007',
      ]);
      assert.deepEqual(await numbers('status=new'), ['210004']);
      assert.deepEqual(await numbers('status=allocated'), ['210006']);
      // The queue of orders waiting for a date includes those already cut.
      assert.deepEqual(await numbers('status=unscheduled'), [
        '210006',
        '210007',
      ]);
      assert.deepEqual(await numbers('status=scheduled'), ['210003']);
      assert.deepEqual(await numbers('status=cut'), ['210002', '210007']);
      assert.deepEqual(await numbers('status=shipped'), ['210001', '210005']);
      // Ship-date bounds are inclusive and combine with the status filter.
      assert.deepEqual(
        await numbers('shipDateFrom=2026-10-02&shipDateTo=2026-10-05'),
        ['210002', '210003'],
      );
      assert.deepEqual(await numbers('shipDateTo=2026-10-01&status=open'), []);
      assert.deepEqual(await numbers('shipDateFrom=2026-10-05'), ['210003']);
      await get(`${path}?shipDateFrom=2026-02-30`).expect(400);
      assert.deepEqual(await numbers('search=0003'), ['210003']);
      assert.deepEqual(await numbers('search=%25'), []);
      const page = workOrderListSchema.parse(
        (await get(`${path}?page=2&pageSize=2`).expect(200)).body,
      );
      assert.deepEqual(
        [page.total, page.page, page.pageSize, page.items.length],
        [7, 2, 2, 2],
      );
      assert.equal(page.items[0]!.orderNumber, '210003');

      // The allocation picker's queue: open orders without an allocation,
      // including a promised one whose allocation was cancelled.
      await pool.query(
        `INSERT INTO work_orders (order_number, quantity, ship_date, scheduled_at)
           VALUES ('210008', 1, '2026-10-06', now())`,
      );
      assert.deepEqual(await numbers('status=unallocated'), [
        '210008',
        '210004',
      ]);
    },
  );
});
