import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  createWorkOrderSchema,
  saveWorkOrderLinesSchema,
  workOrderQuerySchema,
  updateWorkOrderSchema,
} from '@roller-bay/shared/work-orders';

test('work order contracts require a six-digit number, and a ship date is a real weekday set later', () => {
  const input = { orderNumber: ' 104801 ' };
  assert.deepEqual(createWorkOrderSchema.parse(input), {
    orderNumber: '104801',
    note: null,
  });
  for (const orderNumber of ['10480', '1048010', 'RB-1048', '104 801'])
    assert.equal(
      createWorkOrderSchema.safeParse({ ...input, orderNumber }).success,
      false,
    );
  // An order is created without a ship date; it gets one once allocated.
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

test("an order's blind count is derived from its blinds, never entered", () => {
  const input = { orderNumber: '104801' };
  assert.equal(createWorkOrderSchema.safeParse(input).success, true);
  assert.equal(
    createWorkOrderSchema.safeParse({ ...input, quantity: 12 }).success,
    false,
  );
  assert.equal(
    updateWorkOrderSchema.safeParse({ expectedRevision: 1, quantity: 14 })
      .success,
    false,
  );
  // Every field of a blind is required, and its ids are unique in the list.
  const line = {
    id: randomUUID(),
    fabricColorId: randomUUID(),
    widthMm: 1200.5,
    lengthMm: 1800,
    quantity: 2,
  };
  const save = (lines: unknown[]) =>
    saveWorkOrderLinesSchema.safeParse({ expectedRevision: 1, lines }).success;
  assert.equal(save([line]), true);
  assert.equal(save([]), true);
  assert.equal(save([line, line]), false);
  for (const field of ['fabricColorId', 'widthMm', 'lengthMm', 'quantity'])
    assert.equal(save([{ ...line, [field]: undefined }]), false);
  for (const invalid of [{ widthMm: 0 }, { lengthMm: 1.0001 }, { quantity: 0 }])
    assert.equal(save([{ ...line, ...invalid }]), false);
});

test('work order notes are trimmed, bounded, and blank notes clear the note', () => {
  const input = { orderNumber: '104801' };
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

test('work order queries accept each status and the two queue filters', () => {
  for (const status of [
    'open',
    'unscheduled',
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
