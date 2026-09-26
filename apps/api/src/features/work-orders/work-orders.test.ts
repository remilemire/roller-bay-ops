import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { workOrdersOperation } from './work-orders.operation.js';
import type { WorkOrderRecord } from './work-orders.repository.js';
import { presentWorkOrder } from './work-orders.presenter.js';

test('work order status is the furthest step reached', () => {
  const at = new Date('2026-09-19T12:00:00.000Z');
  const row: WorkOrderRecord = {
    id: randomUUID(),
    orderNumber: '104801',
    shipDate: null,
    backOrderPurchaseOrderNumber: null,
    backOrderArrivalDate: null,
    quantity: 12,
    note: null,
    createdAt: at,
    scheduledAt: null,
    allocatedAt: null,
    cutAt: null,
    assembledAt: null,
    checkedAt: null,
    shippedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    updatedAt: at,
    revision: 1,
    deletedAt: null,
  };
  const allocated = { ...row, allocatedAt: at };
  const scheduled = { ...allocated, shipDate: '2026-10-02', scheduledAt: at };
  assert.equal(presentWorkOrder(row).status, 'new');
  assert.equal(presentWorkOrder(allocated).status, 'allocated');
  assert.equal(presentWorkOrder(scheduled).status, 'scheduled');
  // Cutting needs no ship date, and outranks one.
  assert.equal(presentWorkOrder({ ...allocated, cutAt: at }).status, 'cut');
  assert.equal(presentWorkOrder({ ...scheduled, cutAt: at }).status, 'cut');
  // Shipping is not gated on the earlier steps, and outranks them all.
  assert.equal(presentWorkOrder({ ...row, shippedAt: at }).status, 'shipped');
  assert.equal(
    presentWorkOrder({ ...scheduled, cutAt: at, shippedAt: at }).status,
    'shipped',
  );
  // A back-ordered order is scheduled before any fabric is allocated.
  const backOrdered = {
    ...row,
    backOrderPurchaseOrderNumber: '43142',
    backOrderArrivalDate: '2026-09-30',
    shipDate: '2026-10-02',
    scheduledAt: at,
  };
  assert.equal(presentWorkOrder(backOrdered).status, 'scheduled');
  assert.deepEqual(presentWorkOrder(backOrdered).backOrder, {
    purchaseOrderNumber: '43142',
    estimatedArrivalDate: '2026-09-30',
  });
  assert.deepEqual(presentWorkOrder(scheduled), {
    id: row.id,
    orderNumber: '104801',
    shipDate: '2026-10-02',
    quantity: 12,
    note: null,
    backOrder: null,
    status: 'scheduled',
    createdAt: at.toISOString(),
    scheduledAt: at.toISOString(),
    allocatedAt: at.toISOString(),
    cutAt: null,
    assembledAt: null,
    checkedAt: null,
    shippedAt: null,
    cancelledAt: null,
    cancellationReason: null,
    updatedAt: at.toISOString(),
    revision: 1,
  });
});

test('work order driver errors map to conflict, bad request, or unavailable without leaking details', async () => {
  const failures = [
    {
      cause: {
        code: '23505',
        constraint: 'work_orders_order_number_unique',
      },
      expected: ConflictException,
    },
    { cause: { code: '23514' }, expected: BadRequestException },
    ...['40001', '40P01', '55P03'].map((code) => ({
      cause: { code },
      expected: ConflictException,
    })),
    {
      cause: { code: '23505', constraint: 'work_orders_pkey' },
      expected: ServiceUnavailableException,
    },
    {
      cause: new Error('database credentials and query details'),
      expected: ServiceUnavailableException,
    },
  ];
  for (const { cause, expected } of failures)
    await assert.rejects(
      workOrdersOperation(async () => {
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
    workOrdersOperation(async () => {
      throw cycle;
    }),
    ServiceUnavailableException,
  );
  // Feature code's own HTTP errors pass through untouched.
  await assert.rejects(
    workOrdersOperation(async () => {
      throw new NotFoundException('Order not found.');
    }),
    NotFoundException,
  );
});
