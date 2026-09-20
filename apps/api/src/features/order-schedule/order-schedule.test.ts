import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { orderScheduleOperation } from './order-schedule.operation.js';
import type { ScheduledOrderRecord } from './order-schedule.repository.js';
import { presentScheduledOrder } from './order-schedule.presenter.js';

test('scheduled order status is the furthest milestone reached', () => {
  const at = new Date('2026-09-19T12:00:00.000Z');
  const row: ScheduledOrderRecord = {
    id: randomUUID(),
    orderNumber: '104801',
    shipDate: '2026-10-02',
    note: null,
    scheduledAt: at,
    allocatedAt: null,
    cutAt: null,
    shippedAt: null,
    updatedAt: at,
    revision: 1,
  };
  assert.equal(presentScheduledOrder(row).status, 'scheduled');
  assert.equal(
    presentScheduledOrder({ ...row, allocatedAt: at }).status,
    'allocated',
  );
  assert.equal(
    presentScheduledOrder({ ...row, allocatedAt: at, cutAt: at }).status,
    'cut',
  );
  // Shipping is not gated on cutting, and outranks every other milestone.
  assert.equal(
    presentScheduledOrder({ ...row, shippedAt: at }).status,
    'shipped',
  );
  assert.equal(
    presentScheduledOrder({ ...row, allocatedAt: at, cutAt: at, shippedAt: at })
      .status,
    'shipped',
  );
  assert.deepEqual(presentScheduledOrder({ ...row, allocatedAt: at }), {
    id: row.id,
    orderNumber: '104801',
    shipDate: '2026-10-02',
    note: null,
    status: 'allocated',
    scheduledAt: at.toISOString(),
    allocatedAt: at.toISOString(),
    cutAt: null,
    shippedAt: null,
    updatedAt: at.toISOString(),
    revision: 1,
  });
});

test('order schedule driver errors map to conflict or unavailable without leaking details', async () => {
  const failures = [
    {
      cause: {
        code: '23505',
        constraint: 'scheduled_orders_order_number_unique',
      },
      expected: ConflictException,
    },
    { cause: { code: '23503' }, expected: ConflictException },
    ...['40001', '40P01', '55P03'].map((code) => ({
      cause: { code },
      expected: ConflictException,
    })),
    {
      cause: { code: '23505', constraint: 'scheduled_orders_pkey' },
      expected: ServiceUnavailableException,
    },
    {
      cause: new Error('database credentials and query details'),
      expected: ServiceUnavailableException,
    },
  ];
  for (const { cause, expected } of failures)
    await assert.rejects(
      orderScheduleOperation(async () => {
        throw new Error('query details', { cause });
      }),
      (error: unknown) => {
        assert.ok(error instanceof expected);
        assert.doesNotMatch(error.message, /credentials|query details/);
        return true;
      },
    );
  const cycle: { cause?: unknown } = {};
  cycle.cause = cycle;
  await assert.rejects(
    orderScheduleOperation(async () => {
      throw cycle;
    }),
    ServiceUnavailableException,
  );
  // Feature code's own HTTP errors pass through untouched.
  await assert.rejects(
    orderScheduleOperation(async () => {
      throw new NotFoundException('Order not found.');
    }),
    NotFoundException,
  );
});
