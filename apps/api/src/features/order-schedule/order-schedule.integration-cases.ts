import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'pg';
import request from 'supertest';
import { historySchema } from '@roller-bay/shared/audit';
import {
  scheduledOrderListSchema,
  scheduledOrderSchema,
} from '@roller-bay/shared/order-schedule';

export async function testOrderSchedule(
  t: TestContext,
  app: INestApplication,
  pool: Pool,
  schema: string,
  cookie: string,
  userId: string,
  origin: string,
) {
  const server = app.getHttpServer();
  const path = '/api/order-schedule';
  const get = (url: string) => request(server).get(url).set('Cookie', cookie);
  const send = (method: 'post' | 'patch' | 'delete', url: string) =>
    request(server)[method](url).set('Cookie', cookie).set('Origin', origin);
  const post = (body: object) => send('post', path).send(body);
  const patch = (id: string, body: object) =>
    send('patch', `${path}/${id}`).send(body);
  const remove = (id: string, expectedRevision: number) =>
    send('delete', `${path}/${id}`).send({ expectedRevision });
  const role = (value: string) =>
    pool.query(`UPDATE "${schema}".users SET role=$1 WHERE id=$2`, [
      value,
      userId,
    ]);
  try {
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
          await post({ orderNumber: '200001', shipDate: '2026-10-02' }).expect(
            201,
          )
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
        await patch(randomUUID(), { expectedRevision: 1, note: 'x' }).expect(
          404,
        );
        await remove(randomUUID(), 1).expect(404);
        for (const query of ['page=0', 'pageSize=101', 'status=ready', 'x=1'])
          await get(`${path}?${query}`).expect(400);
        for (const body of [
          { orderNumber: '20001', shipDate: '2026-10-02' },
          { orderNumber: '200002', shipDate: '2026-02-30' },
          { orderNumber: '200002', shipDate: '2026-10-03' },
          { orderNumber: '200002', shipDate: '2026-10-04' },
          { orderNumber: '200002' },
          { orderNumber: '200002', shipDate: '2026-10-02', shippedAt: null },
          {
            orderNumber: '200002',
            shipDate: '2026-10-02',
            note: 'x'.repeat(1001),
          },
        ])
          await post(body).expect(400);

        const created = scheduledOrderSchema.parse(
          (
            await post({
              orderNumber: ' 200002 ',
              shipDate: '2026-10-02',
              note: '  Rush  ',
            }).expect(201)
          ).body,
        );
        assert.equal(created.orderNumber, '200002');
        assert.equal(created.note, 'Rush');
        assert.equal(created.status, 'scheduled');
        assert.equal(created.revision, 1);
        assert.deepEqual(
          [created.allocatedAt, created.cutAt, created.shippedAt],
          [null, null, null],
        );

        const duplicate = await post({
          orderNumber: '200002',
          shipDate: '2026-11-02',
        }).expect(409);
        assert.deepEqual(duplicate.body.issues[0].path, ['orderNumber']);
        const concurrent = await Promise.all(
          [1, 2].map(() =>
            post({ orderNumber: '200003', shipDate: '2026-10-05' }),
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
            pool.query(
              `UPDATE "${schema}".scheduled_orders SET ship_date=$1 WHERE id=$2`,
              [shipDate, created.id],
            ),
            { code: '23514', constraint: 'scheduled_orders_ship_date_weekday' },
          );
        const updated = scheduledOrderSchema.parse(
          (
            await patch(created.id, {
              expectedRevision: 1,
              shipDate: '2026-10-09',
              note: ' ',
            }).expect(200)
          ).body,
        );
        assert.equal(updated.shipDate, '2026-10-09');
        assert.equal(updated.note, null);
        assert.equal(updated.revision, 2);
        await patch(created.id, { expectedRevision: 1, note: 'stale' }).expect(
          409,
        );
        await remove(created.id, 1).expect(409);

        const shipped = scheduledOrderSchema.parse(
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
            event.changes.every((c) => c.recordType === 'order-schedule'),
          ),
        );

        await remove(created.id, 5).expect(204);
        await get(`${path}/${created.id}`).expect(404);
        const deleted = historySchema.parse(
          (await get(`${path}/${created.id}/history`).expect(200)).body,
        );
        assert.equal(deleted.items[0]!.action, 'order.deleted');
        assert.equal(deleted.items[0]!.changes[0]!.after, null);
      },
    );

    await t.test(
      'the schedule lists by ship date and filters by derived status and literal search',
      async () => {
        await pool.query(`DELETE FROM "${schema}".scheduled_orders`);
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
            `INSERT INTO "${schema}".scheduled_orders
               (order_number, ship_date, allocated_at, cut_at, shipped_at)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              orderNumber,
              shipDate,
              allocated ? at : null,
              cut ? at : null,
              shipped ? at : null,
            ],
          );
        const numbers = async (query: string) =>
          scheduledOrderListSchema
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
        assert.deepEqual(await numbers('search=0003'), ['210003']);
        assert.deepEqual(await numbers('search=%25'), []);
        const page = scheduledOrderListSchema.parse(
          (await get(`${path}?page=2&pageSize=2`).expect(200)).body,
        );
        assert.deepEqual(
          [page.total, page.page, page.pageSize, page.items.length],
          [5, 2, 2, 2],
        );
        assert.equal(page.items[0]!.orderNumber, '210002');
      },
    );
  } finally {
    await pool.query(`DELETE FROM "${schema}".scheduled_orders`);
    await pool.query(
      `UPDATE "${schema}".users SET role='user', is_active=true WHERE id=$1`,
      [userId],
    );
  }
}
