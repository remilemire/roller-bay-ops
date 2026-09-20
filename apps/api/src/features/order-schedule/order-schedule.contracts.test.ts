import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createScheduledOrderSchema,
  scheduledOrderQuerySchema,
  updateScheduledOrderSchema,
} from '@roller-bay/shared/order-schedule';

test('scheduled order contracts require a six-digit number and a real calendar date', () => {
  const input = { orderNumber: ' 104801 ', shipDate: '2026-10-02' };
  assert.deepEqual(createScheduledOrderSchema.parse(input), {
    orderNumber: '104801',
    shipDate: '2026-10-02',
    note: null,
  });
  for (const orderNumber of ['10480', '1048010', 'RB-1048', '104 801'])
    assert.equal(
      createScheduledOrderSchema.safeParse({ ...input, orderNumber }).success,
      false,
    );
  for (const shipDate of ['2026-02-30', '2026-10-02T00:00:00Z', '10/02/2026'])
    assert.equal(
      createScheduledOrderSchema.safeParse({ ...input, shipDate }).success,
      false,
    );
  // Orders ship Monday to Friday, on create and on edit.
  for (const [shipDate, weekday] of [
    ['2026-10-02', true],
    ['2026-10-03', false],
    ['2026-10-04', false],
    ['2026-10-05', true],
  ] as const) {
    assert.equal(
      createScheduledOrderSchema.safeParse({ ...input, shipDate }).success,
      weekday,
    );
    assert.equal(
      updateScheduledOrderSchema.safeParse({ expectedRevision: 1, shipDate })
        .success,
      weekday,
    );
  }
  assert.equal(
    createScheduledOrderSchema.safeParse({ ...input, shipDate: '2026-10-03' })
      .error!.issues[0]!.message,
    'Must be a weekday.',
  );
  assert.equal(
    createScheduledOrderSchema.safeParse({ ...input, shippedAt: null }).success,
    false,
  );
});

test('scheduled order notes are trimmed, bounded, and blank notes clear the note', () => {
  const input = { orderNumber: '104801', shipDate: '2026-10-02' };
  const note = (value: string | null) =>
    createScheduledOrderSchema.parse({ ...input, note: value }).note;
  assert.equal(note('  Rush  '), 'Rush');
  assert.equal(note('   '), null);
  assert.equal(note(null), null);
  assert.equal(
    createScheduledOrderSchema.safeParse({ ...input, note: 'x'.repeat(1001) })
      .success,
    false,
  );
});

test('scheduled order updates require a revision and a change, and cannot rename the order', () => {
  assert.equal(
    updateScheduledOrderSchema.safeParse({ expectedRevision: 1 }).success,
    false,
  );
  assert.equal(
    updateScheduledOrderSchema.safeParse({ shipped: true }).success,
    false,
  );
  assert.equal(
    updateScheduledOrderSchema.safeParse({
      expectedRevision: 1,
      orderNumber: '104802',
    }).success,
    false,
  );
  // An omitted note is left alone; a blank one is cleared.
  assert.deepEqual(
    updateScheduledOrderSchema.parse({ expectedRevision: 2, shipped: false }),
    { expectedRevision: 2, shipped: false },
  );
  assert.deepEqual(
    updateScheduledOrderSchema.parse({ expectedRevision: 2, note: ' ' }),
    { expectedRevision: 2, note: null },
  );
});

test('scheduled order queries accept each status and the open filter', () => {
  for (const status of ['open', 'scheduled', 'allocated', 'cut', 'shipped'])
    assert.equal(scheduledOrderQuerySchema.parse({ status }).status, status);
  assert.equal(
    scheduledOrderQuerySchema.safeParse({ status: 'ready' }).success,
    false,
  );
  assert.deepEqual(scheduledOrderQuerySchema.parse({}), {
    page: 1,
    pageSize: 25,
  });
});
