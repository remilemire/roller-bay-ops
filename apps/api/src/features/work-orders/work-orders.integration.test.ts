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
    'schedule reads require a session and every write requires admin or owner',
    async () => {
      await role('user');
      await request(server).get(path).expect(401);
      await request(server).get(`${path}/${randomUUID()}`).expect(401);
      await request(server)
        .post(path)
        .set('Origin', origin)
        .send({})
        .expect(401);
      await get(path).expect(200);
      await get(`${path}/${randomUUID()}/history`).expect(200);
      await post({}).expect(403);
      await patch(randomUUID(), {}).expect(403);
      await remove(randomUUID(), 1).expect(403);
      await role('owner');
      const order = (
        await post({
          orderNumber: '200001',
          shipDate: '2026-10-02',
          quantity: 12,
        }).expect(201)
      ).body;
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
    'scheduled orders validate input, keep a unique number, and check revisions',
    async () => {
      await get(`${path}/invalid`).expect(400);
      await get(`${path}/${randomUUID()}`).expect(404);
      await patch(randomUUID(), { expectedRevision: 1, note: 'x' }).expect(404);
      await remove(randomUUID(), 1).expect(404);
      for (const query of ['page=0', 'pageSize=101', 'status=ready', 'x=1'])
        await get(`${path}?${query}`).expect(400);
      for (const body of [
        { orderNumber: '20001', shipDate: '2026-10-02', quantity: 12 },
        { orderNumber: '200002', shipDate: '2026-02-30', quantity: 12 },
        { orderNumber: '200002', shipDate: '2026-10-03', quantity: 12 },
        { orderNumber: '200002', shipDate: '2026-10-04', quantity: 12 },
        { orderNumber: '200002' },
        {
          orderNumber: '200002',
          shipDate: '2026-10-02',
          quantity: 12,
          shippedAt: null,
        },
        // Every order states how many blinds it has.
        { orderNumber: '200002', shipDate: '2026-10-02' },
        ...[0, -1, 1.5, '12', null, 1000001].map((quantity) => ({
          orderNumber: '200002',
          shipDate: '2026-10-02',
          quantity,
        })),
        {
          orderNumber: '200002',
          shipDate: '2026-10-02',
          quantity: 12,
          note: 'x'.repeat(1001),
        },
      ])
        await post(body).expect(400);

      const created = workOrderSchema.parse(
        (
          await post({
            orderNumber: ' 200002 ',
            shipDate: '2026-10-02',
            quantity: 12,
            note: '  Rush  ',
          }).expect(201)
        ).body,
      );
      assert.equal(created.orderNumber, '200002');
      assert.equal(created.note, 'Rush');
      assert.equal(created.quantity, 12);
      assert.equal(created.status, 'scheduled');
      assert.equal(created.revision, 1);
      assert.deepEqual(
        [created.allocatedAt, created.cutAt, created.shippedAt],
        [null, null, null],
      );

      const duplicate = await post({
        orderNumber: '200002',
        shipDate: '2026-11-02',
        quantity: 12,
      }).expect(409);
      assert.deepEqual(duplicate.body.issues[0].path, ['orderNumber']);
      const concurrent = await Promise.all(
        [1, 2].map(() =>
          post({
            orderNumber: '200003',
            shipDate: '2026-10-05',
            quantity: 12,
          }),
        ),
      );
      assert.deepEqual(concurrent.map((r) => r.status).sort(), [201, 409]);

      // The order number is fixed once scheduled.
      await patch(created.id, {
        expectedRevision: 1,
        orderNumber: '200009',
      }).expect(400);
      await patch(created.id, { expectedRevision: 1 }).expect(400);
      const weekend = await patch(created.id, {
        expectedRevision: 1,
        shipDate: '2026-10-10',
      }).expect(400);
      assert.deepEqual(weekend.body.issues[0].path, ['shipDate']);
      assert.equal(weekend.body.issues[0].message, 'Must be a weekday.');
      // The database holds the same rule for writes that bypass the API.
      for (const shipDate of ['2026-10-03', '2026-10-04'])
        await assert.rejects(
          pool.query(`UPDATE work_orders SET ship_date=$1 WHERE id=$2`, [
            shipDate,
            created.id,
          ]),
          { code: '23514', constraint: 'work_orders_ship_date_weekday' },
        );
      const updated = workOrderSchema.parse(
        (
          await patch(created.id, {
            expectedRevision: 1,
            shipDate: '2026-10-09',
            quantity: 14,
            note: ' ',
          }).expect(200)
        ).body,
      );
      assert.equal(updated.shipDate, '2026-10-09');
      // An order without an allocation can change its quantity.
      assert.equal(updated.quantity, 14);
      await patch(created.id, { expectedRevision: 2, quantity: 0 }).expect(400);
      assert.equal(updated.note, null);
      assert.equal(updated.revision, 2);
      await patch(created.id, { expectedRevision: 1, note: 'stale' }).expect(
        409,
      );
      await remove(created.id, 1).expect(409);

      const shipped = workOrderSchema.parse(
        (
          await patch(created.id, {
            expectedRevision: 2,
            shipped: true,
          }).expect(200)
        ).body,
      );
      assert.equal(shipped.status, 'shipped');
      assert.ok(shipped.shippedAt);
      // Shipping again keeps the original time.
      const again = (
        await patch(created.id, {
          expectedRevision: 3,
          shipped: true,
        }).expect(200)
      ).body;
      assert.equal(again.shippedAt, shipped.shippedAt);
      const unshipped = (
        await patch(created.id, {
          expectedRevision: 4,
          shipped: false,
        }).expect(200)
      ).body;
      assert.equal(unshipped.status, 'scheduled');
      assert.equal(unshipped.shippedAt, null);

      const history = historySchema.parse(
        (await get(`${path}/${created.id}/history`).expect(200)).body,
      );
      assert.deepEqual(history.items.map((event) => event.action).sort(), [
        'order.scheduled',
        'order.shipped',
        'order.unshipped',
        'order.updated',
        'order.updated',
      ]);
      assert.ok(
        history.items.every((event) =>
          event.changes.every((c) => c.recordType === 'work-orders'),
        ),
      );

      await remove(created.id, 5).expect(204);
      await get(`${path}/${created.id}`).expect(404);
      const deleted = historySchema.parse(
        (await get(`${path}/${created.id}/history`).expect(200)).body,
      );
      assert.equal(deleted.items[0]!.action, 'order.deleted');
      assert.equal(deleted.items[0]!.changes[0]!.after, null);

      // The order is kept, out of sight: allocations reference its number.
      assert.deepEqual(
        workOrderListSchema
          .parse((await get(`${path}?search=200002`).expect(200)).body)
          .items.map((order) => order.orderNumber),
        [],
      );
      await patch(created.id, { expectedRevision: 6, note: 'gone' }).expect(
        404,
      );
      await remove(created.id, 6).expect(404);
      const kept = await pool.query(
        `SELECT deleted_at FROM work_orders WHERE id=$1`,
        [created.id],
      );
      assert.ok(kept.rows[0].deleted_at);

      // Scheduling the number again restores that order with the new details.
      const restored = workOrderSchema.parse(
        (
          await post({
            orderNumber: '200002',
            shipDate: '2026-11-02',
            quantity: 3,
          }).expect(201)
        ).body,
      );
      assert.equal(restored.id, created.id);
      assert.deepEqual(
        [restored.shipDate, restored.quantity, restored.note],
        ['2026-11-02', 3, null],
      );
      assert.equal(restored.status, 'scheduled');
      assert.equal(restored.shippedAt, null);
      assert.equal(restored.revision, 7);
      assert.ok(restored.scheduledAt > created.scheduledAt);
      const history2 = historySchema.parse(
        (await get(`${path}/${created.id}/history`).expect(200)).body,
      );
      assert.equal(history2.items[0]!.action, 'order.restored');
      assert.equal(history2.items[0]!.changes[0]!.before, null);
      // Once restored it is an ordinary scheduled order again.
      await post({
        orderNumber: '200002',
        shipDate: '2026-11-03',
        quantity: 3,
      }).expect(409);
    },
  );

  await t.test(
    'the schedule lists by ship date and filters by derived status and literal search',
    async () => {
      await pool.query(`DELETE FROM work_orders`);
      const at = '2026-09-01T12:00:00Z';
      // [order number, ship date, allocated, cut, shipped]
      const rows: [string, string, boolean, boolean, boolean][] = [
        ['210004', '2026-10-06', false, false, false],
        ['210003', '2026-10-05', true, false, false],
        ['210002', '2026-10-02', true, true, false],
        ['210001', '2026-10-01', true, true, true],
        ['210005', '2026-10-01', false, false, true],
      ];
      for (const [orderNumber, shipDate, allocated, cut, shipped] of rows)
        await pool.query(
          `INSERT INTO work_orders
               (order_number, ship_date, quantity, allocated_at, cut_at, shipped_at)
             VALUES ($1, $2, 1, $3, $4, $5)`,
          [
            orderNumber,
            shipDate,
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
        '210005',
        '210002',
        '210003',
        '210004',
      ]);
      assert.deepEqual(await numbers('status=open'), [
        '210002',
        '210003',
        '210004',
      ]);
      assert.deepEqual(await numbers('status=scheduled'), ['210004']);
      assert.deepEqual(await numbers('status=allocated'), ['210003']);
      assert.deepEqual(await numbers('status=cut'), ['210002']);
      assert.deepEqual(await numbers('status=shipped'), ['210001', '210005']);
      // Ship-date bounds are inclusive and combine with the status filter.
      assert.deepEqual(
        await numbers('shipDateFrom=2026-10-02&shipDateTo=2026-10-05'),
        ['210002', '210003'],
      );
      assert.deepEqual(await numbers('shipDateTo=2026-10-01&status=open'), []);
      assert.deepEqual(await numbers('shipDateFrom=2026-10-06'), ['210004']);
      await get(`${path}?shipDateFrom=2026-02-30`).expect(400);
      assert.deepEqual(await numbers('search=0003'), ['210003']);
      assert.deepEqual(await numbers('search=%25'), []);
      const page = workOrderListSchema.parse(
        (await get(`${path}?page=2&pageSize=2`).expect(200)).body,
      );
      assert.deepEqual(
        [page.total, page.page, page.pageSize, page.items.length],
        [5, 2, 2, 2],
      );
      assert.equal(page.items[0]!.orderNumber, '210002');
    },
  );
});
