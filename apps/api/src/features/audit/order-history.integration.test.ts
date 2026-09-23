import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startAllocationsApp } from '../allocations/testing/allocations-app.js';

test(
  'order history includes worksheets, isolates orders and paginates unique events',
  { timeout: 60_000 },
  async (t) => {
    const { post, get, create, input, seed, fixtures, userId } =
      await startAllocationsApp(t);
    await fixtures.setUserRole(userId, 'admin');
    const employee = (
      await post('/api/employees', {
        name: 'History Cutter',
        initials: 'HC',
      }).expect(201)
    ).body;
    const order = await create(await input(await seed()));
    const other = await create(await input(await seed()));
    const sheet = (
      await post(
        `/api/production/cutting/orders/${order.workOrderId}/worksheet`,
        { employeeId: employee.id },
      ).expect(201)
    ).body;
    await post(`/api/production/cutting/worksheets/${sheet.id}/abandon`, {
      expectedRevision: sheet.revision,
      reason: 'Unused sheet',
    }).expect(201);
    const history = (
      await get(`/api/work-orders/${order.workOrderId}/history`).expect(200)
    ).body;
    assert.deepEqual(
      history.items.map((e: { action: string }) => e.action).sort(),
      ['allocation.confirmed', 'cutting.abandoned', 'cutting.started'],
    );
    assert.equal(
      new Set(history.items.map((e: { id: string }) => e.id)).size,
      history.total,
    );
    const first = (
      await get(
        `/api/work-orders/${order.workOrderId}/history?pageSize=1`,
      ).expect(200)
    ).body;
    const next = (
      await get(
        `/api/work-orders/${order.workOrderId}/history?pageSize=1&page=2`,
      ).expect(200)
    ).body;
    assert.equal(first.total, 3);
    assert.notEqual(first.items[0].id, next.items[0].id);
    const unrelated = (
      await get(`/api/work-orders/${other.workOrderId}/history`).expect(200)
    ).body;
    assert.equal(unrelated.total, 1);
  },
);
