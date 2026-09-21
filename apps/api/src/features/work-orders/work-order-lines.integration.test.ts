import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import request from 'supertest';
import { startSignedInApp } from '../../testing/integration-app.js';
import { historySchema } from '@roller-bay/shared/audit';
import {
  workOrderDetailSchema,
  type WorkOrderLine,
} from '@roller-bay/shared/work-orders';

test('work order lines integration', { timeout: 60_000 }, async (t) => {
  const { app, pool, cookie, userId, origin, fixtures } =
    await startSignedInApp(t);
  const server = app.getHttpServer();
  const { color } = await fixtures.createColorAndLocation();
  const detail = async (id: string) =>
    workOrderDetailSchema.parse(
      (
        await request(server)
          .get(`/api/work-orders/${id}`)
          .set('Cookie', cookie)
          .expect(200)
      ).body,
    );
  const save = (id: string, expectedRevision: number, lines: object[]) =>
    request(server)
      .put(`/api/work-orders/${id}/lines`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send({ expectedRevision, lines });
  const line = (values: Partial<WorkOrderLine> = {}): WorkOrderLine => ({
    id: randomUUID(),
    fabricColorId: color,
    widthMm: 1200.5,
    lengthMm: 1800,
    quantity: 2,
    ...values,
  });
  const issues = (body: { issues?: { code: string; path: unknown }[] }) =>
    body.issues?.map(({ code, path }) => ({ code, path }));
  // The signed-in employee saves blinds; only creating the order takes an
  // admin, so the fixture makes them.
  let next = 400000;
  const order = async () => {
    const orderNumber = String(++next);
    await fixtures.createWorkOrders(next, next);
    return detail((await fixtures.workOrder(orderNumber)).id);
  };

  await t.test(
    'an employee saves an order of blinds, which keeps, adds, reorders and retires them',
    async () => {
      const created = await order();
      assert.deepEqual(created.lines, []);
      await request(server)
        .put(`/api/work-orders/${created.id}/lines`)
        .set('Origin', origin)
        .send({ expectedRevision: 1, lines: [] })
        .expect(401);
      await request(server)
        .put(`/api/work-orders/${created.id}/lines`)
        .set('Cookie', cookie)
        .send({ expectedRevision: 1, lines: [] })
        .expect(403);

      const [a, b, c] = [line(), line({ quantity: 1 }), line({ widthMm: 900 })];
      const saved = workOrderDetailSchema.parse(
        (await save(created.id, 1, [a, b]).expect(200)).body,
      );
      assert.deepEqual(saved.lines, [a, b]);
      assert.equal(saved.revision, 2);
      // The order's own fields are not the lines' to change.
      assert.deepEqual(
        { ...saved, lines: [], revision: 1, updatedAt: created.updatedAt },
        created,
      );

      // Kept blinds may move; a dropped one is retired, not deleted.
      const reordered = workOrderDetailSchema.parse(
        (await save(created.id, 2, [c, a]).expect(200)).body,
      );
      assert.deepEqual(reordered.lines, [c, a]);
      assert.deepEqual((await detail(created.id)).lines, [c, a]);
      const rows = await pool.query(
        `SELECT id, retired_at IS NOT NULL AS retired FROM work_order_lines WHERE work_order_id=$1`,
        [created.id],
      );
      assert.deepEqual(
        new Map(rows.rows.map((row) => [row.id, row.retired])),
        new Map([
          [a.id, false],
          [b.id, true],
          [c.id, false],
        ]),
      );

      const history = historySchema.parse(
        (
          await request(server)
            .get(`/api/work-orders/${created.id}/history`)
            .set('Cookie', cookie)
            .expect(200)
        ).body,
      );
      const event = history.items[0]!;
      assert.equal(event.action, 'order.lines-saved');
      assert.equal(event.actorId, userId);
      const [change] = event.changes;
      assert.ok(
        change?.before?.type === 'work-orders' &&
          change.after?.type === 'work-orders',
      );
      assert.deepEqual(change.before.value.lines, [a, b]);
      assert.deepEqual(change.after.value.lines, [c, a]);
    },
  );

  await t.test(
    'a saved blind cannot change or come back, and input is validated',
    async () => {
      const { id } = await order();
      const [a, b] = [line(), line()];
      await save(id, 1, [a, b]).expect(200);
      const changed = await save(id, 2, [{ ...a, widthMm: 1300 }, b]).expect(
        400,
      );
      assert.deepEqual(issues(changed.body), [
        { code: 'line_immutable', path: ['lines', 0] },
      ]);
      // The edit arrives as a new blind instead.
      const replacement = line({ widthMm: 1300 });
      await save(id, 2, [replacement, b]).expect(200);
      const back = await save(id, 3, [replacement, b, a]).expect(400);
      assert.deepEqual(issues(back.body), [
        { code: 'line_retired', path: ['lines', 2] },
      ]);
      // A refused save changes nothing.
      const current = await detail(id);
      assert.deepEqual(current.lines, [replacement, b]);
      assert.equal(current.revision, 3);

      for (const lines of [
        [{ ...line(), widthMm: 0 }],
        [{ ...line(), lengthMm: 1.0001 }],
        [{ ...line(), quantity: 0 }],
        [{ ...line(), quantity: 1.5 }],
        [{ ...line(), fabricColorId: null }],
        [{ ...line(), lengthAllowanceMm: 10 }],
        // Every field is required: a half-entered blind stays in the form.
        [{ id: randomUUID(), fabricColorId: color, quantity: 1 }],
        [a, a].map(() => replacement),
      ])
        await save(id, 3, lines).expect(400);
      await request(server)
        .put(`/api/work-orders/${id}/lines`)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .send({ lines: [] })
        .expect(400);

      const unknown = await save(id, 3, [
        line({ fabricColorId: randomUUID() }),
      ]).expect(404);
      assert.deepEqual(issues(unknown.body), [
        { code: 'fabric_color_not_found', path: ['lines'] },
      ]);
      // An id identifies one blind across all orders.
      const other = await order();
      const taken = await save(other.id, 1, [b]).expect(400);
      assert.deepEqual(issues(taken.body), [
        { code: 'line_id_in_use', path: ['lines'] },
      ]);
      assert.deepEqual((await detail(other.id)).lines, []);
    },
  );

  await t.test(
    'saves check the revision, serialize, and stop for an allocated or deleted order',
    async () => {
      const { id } = await order();
      await save(id, 9, [line()]).expect(409);
      const race = await Promise.all([
        save(id, 1, [line()]),
        save(id, 1, [line()]),
      ]);
      assert.deepEqual(race.map((reply) => reply.status).sort(), [200, 409]);
      assert.equal((await detail(id)).lines.length, 1);

      // Allocating is the allocation suites' subject; this order only needs
      // to have been allocated. Its cuts were planned for these blinds.
      await pool.query(
        `UPDATE work_orders SET allocated_at=now() WHERE id=$1`,
        [id],
      );
      const frozen = await save(id, 2, []).expect(409);
      assert.deepEqual(issues(frozen.body), [
        { code: 'order_allocated', path: ['lines'] },
      ]);
      assert.equal((await detail(id)).lines.length, 1);

      const gone = await order();
      await fixtures.setUserRole(userId, 'admin');
      await request(server)
        .delete(`/api/work-orders/${gone.id}`)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .send({ expectedRevision: 1 })
        .expect(204);
      await fixtures.setUserRole(userId, 'user');
      await save(gone.id, 2, [line()]).expect(404);
      await save(randomUUID(), 1, []).expect(404);
    },
  );
});
