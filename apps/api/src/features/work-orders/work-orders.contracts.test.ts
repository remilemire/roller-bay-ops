import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createWorkOrderSchema,
  workOrderQuerySchema,
  updateWorkOrderSchema,
} from '@roller-bay/shared/work-orders';

test('work order contracts require a six-digit number, and a ship date is a real weekday set later', () => {
  const input = { orderNumber: ' 104801 ', quantity: 12 };
  assert.deepEqual(createWorkOrderSchema.parse(input), {
    orderNumber: '104801',
    quantity: 12,
    note: null,
    backOrder: null,
    shipDate: null,
  });
  for (const orderNumber of ['10480', '1048010', 'RB-1048', '104 801'])
    assert.equal(
      createWorkOrderSchema.safeParse({ ...input, orderNumber }).success,
      false,
    );
  // An order is created unallocated, so only a back order can date it.
  for (const extra of [{ shipDate: '2026-10-02' }, { shippedAt: null }])
    assert.equal(
      createWorkOrderSchema.safeParse({ ...input, ...extra }).success,
      false,
    );
  const reschedule = (shipDate: unknown) =>
    updateWorkOrderSchema.safeParse({ expectedRevision: 1, shipDate });
  for (const shipDate of ['2026-02-30', '2026-10-02T00:00:00Z', '10/02/2026'])
    assert.equal(reschedule(shipDate).success, false);
  // Orders ship Monday to Friday.
  for (const [shipDate, weekday] of [
    ['2026-10-02', true],
    ['2026-10-03', false],
    ['2026-10-04', false],
    ['2026-10-05', true],
  ] as const)
    assert.equal(reschedule(shipDate).success, weekday);
  assert.equal(
    reschedule('2026-10-03').error!.issues[0]!.message,
    'Must be a weekday.',
  );
  // A null date takes the order off the schedule, and is a change on its own.
  assert.deepEqual(reschedule(null).data, {
    expectedRevision: 1,
    shipDate: null,
  });
});

test('an order states its blind count, a whole number from 1 to 10,000', () => {
  const input = { orderNumber: '104801', quantity: 12 };
  const create = (quantity: unknown) =>
    createWorkOrderSchema.safeParse({ ...input, quantity }).success;
  const update = (quantity: unknown) =>
    updateWorkOrderSchema.safeParse({ expectedRevision: 1, quantity }).success;
  for (const [quantity, valid] of [
    [1, true],
    [10000, true],
    [undefined, false],
    [0, false],
    [1.5, false],
    [10001, false],
    ['12', false],
  ] as const) {
    assert.equal(create(quantity), valid);
    // An update may leave the quantity alone, but it is then no change.
    assert.equal(update(quantity), valid);
  }
});

test('work order notes are trimmed, bounded, and blank notes clear the note', () => {
  const input = { orderNumber: '104801', quantity: 1 };
  const note = (value: string | null) =>
    createWorkOrderSchema.parse({ ...input, note: value }).note;
  assert.equal(note('  Rush  '), 'Rush');
  assert.equal(note('   '), null);
  assert.equal(note(null), null);
  assert.equal(
    createWorkOrderSchema.safeParse({ ...input, note: 'x'.repeat(1001) })
      .success,
    false,
  );
});

test('work order updates require a revision and a change, and cannot rename the order', () => {
  assert.equal(
    updateWorkOrderSchema.safeParse({ expectedRevision: 1 }).success,
    false,
  );
  assert.equal(
    updateWorkOrderSchema.safeParse({ shipped: true }).success,
    false,
  );
  assert.equal(
    updateWorkOrderSchema.safeParse({
      expectedRevision: 1,
      orderNumber: '104802',
    }).success,
    false,
  );
  // An omitted note is left alone; a blank one is cleared.
  assert.equal(
    updateWorkOrderSchema.safeParse({ expectedRevision: 2, shipped: false })
      .success,
    false,
  );
  assert.deepEqual(
    updateWorkOrderSchema.parse({ expectedRevision: 2, note: ' ' }),
    { expectedRevision: 2, note: null },
  );
});

test('work order queries accept each status and the three queue filters', () => {
  for (const status of [
    'open',
    'unscheduled',
    'unallocated',
    'new',
    'allocated',
    'scheduled',
    'cut',
    'shipped',
  ])
    assert.equal(workOrderQuerySchema.parse({ status }).status, status);
  assert.equal(
    workOrderQuerySchema.safeParse({ status: 'ready' }).success,
    false,
  );
  // The calendar views bound the list by ship date; the bounds may be any
  // calendar day, including a weekend.
  assert.deepEqual(
    workOrderQuerySchema.parse({
      shipDateFrom: '2026-10-03',
      shipDateTo: '2026-10-31',
    }),
    {
      page: 1,
      pageSize: 25,
      shipDateFrom: '2026-10-03',
      shipDateTo: '2026-10-31',
    },
  );
  for (const shipDateFrom of ['2026-02-30', '2026-10', 'today'])
    assert.equal(
      workOrderQuerySchema.safeParse({ shipDateFrom }).success,
      false,
    );
  assert.deepEqual(workOrderQuerySchema.parse({}), {
    page: 1,
    pageSize: 25,
  });
});

test('order cancellation requests require reviewed revisions, a reason and an explicit skip choice', async () => {
  const { orderCancellationSchema } =
    await import('@roller-bay/shared/work-orders');
  const base = {
    expectedRevision: 1,
    allocationId: null,
    expectedAllocationRevision: null,
    worksheetId: null,
    expectedWorksheetRevision: null,
    reason: ' Stop this job ',
  };
  const parsed = orderCancellationSchema.parse(base);
  assert.equal(parsed.reason, 'Stop this job');
  assert.equal(parsed.skipCuttingResults, false);
  assert.equal(
    orderCancellationSchema.safeParse({ ...base, reason: '' }).success,
    false,
  );
  assert.equal(
    orderCancellationSchema.safeParse({
      ...base,
      action: 'unschedule',
      skipCuttingResults: true,
    }).success,
    false,
  );
  assert.equal(
    orderCancellationSchema.safeParse({ ...base, expectedRevision: 0 }).success,
    false,
  );
});

test('a back order names a five-digit supplier PO and an arrival that the ship date follows', () => {
  const input = { orderNumber: '104801', quantity: 12 };
  const backOrder = {
    purchaseOrderNumber: ' 43142 ',
    estimatedArrivalDate: '2026-10-03',
  };
  const create = (extra: object) =>
    createWorkOrderSchema.safeParse({ ...input, ...extra });
  // Fabric may arrive on any day; the order still ships on a weekday.
  assert.deepEqual(create({ backOrder, shipDate: '2026-10-05' }).data, {
    ...input,
    note: null,
    backOrder: {
      purchaseOrderNumber: '43142',
      estimatedArrivalDate: '2026-10-03',
    },
    shipDate: '2026-10-05',
  });
  assert.equal(create({ backOrder }).success, true);
  const early = create({ backOrder, shipDate: '2026-10-02' });
  assert.deepEqual(
    early.error!.issues.map(({ path, message }) => [path.join('.'), message]),
    [['shipDate', "Must be on or after the fabric's estimated arrival."]],
  );
  for (const partial of [
    { purchaseOrderNumber: '43142' },
    { estimatedArrivalDate: '2026-10-03' },
    { ...backOrder, purchaseOrderNumber: '4314' },
    { ...backOrder, estimatedArrivalDate: '10/03/2026' },
  ])
    assert.equal(create({ backOrder: partial }).success, false);
  // On its own it is a change, and null clears it.
  for (const value of [backOrder, null])
    assert.equal(
      updateWorkOrderSchema.safeParse({ expectedRevision: 1, backOrder: value })
        .success,
      true,
    );
});
