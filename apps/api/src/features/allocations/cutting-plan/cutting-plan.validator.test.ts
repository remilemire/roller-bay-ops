import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  CuttingContext,
  CuttingPlan,
} from '@roller-bay/shared/allocations';
import { validateCuttingPlan } from './cutting-plan.validator.js';

test('validates the allocator example in millimetres, including three separate remnants', () => {
  const inches = (value: number) => Number((value * 25.4).toFixed(3));
  const yards = (value: number) => Number((value * 914.4).toFixed(3));
  const specs = [
    [54, 2.5, 1, 10],
    [22, 1.5, 2, 10],
    [70, 1, 1, 10],
    [53.5, 3.5, 1, 11],
    [24, 1, 3, 11],
  ] as const;
  const context: CuttingContext = {
    requirements: specs.map(([width, length, quantity, color], index) => ({
      id: id(index + 1),
      fabricColorId: id(color),
      widthMm: inches(width),
      lengthMm: yards(length),
      lengthAllowanceMm: yards(0.5),
      quantity,
    })),
    stockItems: (
      [
        [20, 10, 118, 10, false],
        [21, 11, 72, 10, false],
        [22, 11, 30, 2, true],
        [23, 11, 30, 2, true],
        [24, 11, 30, 2, true],
      ] as const
    ).map(([stockId, color, width, length, remnant]) => ({
      id: id(stockId),
      fabricColorId: id(color),
      widthMm: inches(width),
      remainingLengthMm: yards(length),
      isRemnant: remnant,
      isUsed: remnant,
      reservedLengthMm: 0,
      consumedAt: null,
    })),
    settings: {
      edgeTrimMm: inches(0.5),
      minimumRemnantWidthMm: inches(20),
      minimumRemnantLengthMm: yards(0.5),
    },
  };
  const plan: CuttingPlan = {
    drops: [
      {
        stockItemId: id(20),
        lengthMm: yards(3),
        items: [
          { requirementId: id(1), quantity: 1 },
          { requirementId: id(2), quantity: 2 },
        ],
      },
      {
        stockItemId: id(20),
        lengthMm: yards(1.5),
        items: [{ requirementId: id(3), quantity: 1 }],
      },
      {
        stockItemId: id(21),
        lengthMm: yards(4),
        items: [{ requirementId: id(4), quantity: 1 }],
      },
      ...[22, 23, 24].map((stockId) => ({
        stockItemId: id(stockId),
        lengthMm: yards(1.5),
        items: [{ requirementId: id(5), quantity: 1 }],
      })),
    ],
  };
  const summary = valid(context, plan);
  assert.equal(summary.dropCount, 6);
  assert.equal(summary.stockItemCount, 5);
  assert.equal(
    summary.reservations.find((item) => item.stockItemId === id(20))!
      .reservedLengthMm,
    yards(4.5),
  );
  for (const stockId of [22, 23, 24])
    assert.equal(
      summary.reservations.find((item) => item.stockItemId === id(stockId))!
        .reservedLengthMm,
      yards(2),
    );
  context.stockItems[1]!.widthMm = inches(54);
  invalid(context, plan, 'width_capacity');
});

const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;
function fixture(): { context: CuttingContext; plan: CuttingPlan } {
  return {
    context: {
      requirements: [
        {
          id: id(1),
          fabricColorId: id(10),
          widthMm: 54,
          lengthMm: 25,
          lengthAllowanceMm: 5,
          quantity: 1,
        },
        {
          id: id(2),
          fabricColorId: id(10),
          widthMm: 22,
          lengthMm: 15,
          lengthAllowanceMm: 5,
          quantity: 2,
        },
      ],
      stockItems: [
        {
          id: id(20),
          fabricColorId: id(10),
          widthMm: 118,
          remainingLengthMm: 100,
          reservedLengthMm: 0,
          isRemnant: false,
          isUsed: false,
          consumedAt: null,
        },
      ],
      settings: {
        edgeTrimMm: 1,
        minimumRemnantWidthMm: 20,
        minimumRemnantLengthMm: 10,
      },
    },
    plan: {
      drops: [
        {
          stockItemId: id(20),
          lengthMm: 30,
          items: [
            { requirementId: id(1), quantity: 1 },
            { requirementId: id(2), quantity: 2 },
          ],
        },
      ],
    },
  };
}
function valid(context: CuttingContext, plan: CuttingPlan) {
  const result = validateCuttingPlan(context, plan);
  assert.equal(result.valid, true, JSON.stringify(result));
  if (!result.valid) throw new Error('Expected valid plan');
  return result.summary;
}
function invalid(context: unknown, plan: unknown, code: string) {
  const result = validateCuttingPlan(context, plan);
  assert.equal(result.valid, false);
  if (result.valid) throw new Error('Expected invalid plan');
  assert.ok(
    result.issues.some((issue) => issue.code === code),
    JSON.stringify(result),
  );
}

test('unresolved references return issues without a partial summary or cascading rule errors', () => {
  const { context, plan } = fixture();
  plan.drops[0]!.stockItemId = id(98);
  plan.drops[0]!.items[0]!.requirementId = id(99);
  const result = validateCuttingPlan(context, plan);
  assert.equal(result.valid, false);
  if (result.valid) throw new Error('Expected invalid plan');
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    ['unknown_stock', 'unknown_requirement'],
  );
  assert.equal('summary' in result, false);
});

test('requirement, geometry, and availability failures are reported together without accounting', () => {
  const { context, plan } = fixture();
  context.stockItems[0]!.fabricColorId = id(99);
  context.stockItems[0]!.widthMm = 1;
  context.stockItems[0]!.remainingLengthMm = 1;
  const result = validateCuttingPlan(context, plan);
  assert.equal(result.valid, false);
  if (result.valid) throw new Error('Expected invalid plan');
  for (const code of ['color_mismatch', 'width_capacity', 'length_capacity']) {
    assert.ok(result.issues.some((issue) => issue.code === code));
  }
  assert.equal('summary' in result, false);
});

test('groups unequal drops, includes allowance once, and independently balances areas', () => {
  const { context, plan } = fixture();
  const summary = valid(context, plan);
  assert.equal(summary.inputAreaMm2, '3540.000000');
  assert.equal(summary.requiredAreaMm2, '2500.000000');
  assert.equal(summary.reusableAreaMm2, '440.000000');
  assert.equal(summary.wasteAreaMm2, '600.000000');
  assert.deepEqual(summary.reservations, [
    { stockItemId: id(20), reservedLengthMm: 30 },
  ]);
  assert.equal(summary.newRollCount, 1);
});

test('only outside edges require trim, with exact boundary accepted', () => {
  const { context, plan } = fixture();
  context.stockItems[0]!.widthMm = 100;
  valid(context, plan);
  context.stockItems[0]!.widthMm = 99.999;
  invalid(context, plan, 'width_capacity');
});

test('orientation cannot be swapped to make a blind fit', () => {
  const { context, plan } = fixture();
  context.requirements = [
    {
      ...context.requirements[0]!,
      widthMm: 60,
      lengthMm: 40,
      lengthAllowanceMm: 0,
    },
  ];
  context.stockItems[0]!.widthMm = 52;
  plan.drops[0]!.items = [{ requirementId: id(1), quantity: 1 }];
  plan.drops[0]!.lengthMm = 40;
  invalid(context, plan, 'width_capacity');
});

test('both short and excessive drops are rejected', () => {
  for (const length of [29.999, 30.001]) {
    const { context, plan } = fixture();
    plan.drops[0]!.lengthMm = length;
    invalid(context, plan, 'drop_length');
  }
});

test('aggregates multiple drops and subtracts active reservations', () => {
  const { context, plan } = fixture();
  context.requirements[0]!.quantity = 2;
  context.requirements[1]!.quantity = 4;
  plan.drops.push(structuredClone(plan.drops[0]!));
  context.stockItems[0]!.reservedLengthMm = 40;
  assert.equal(valid(context, plan).reservations[0]!.reservedLengthMm, 60);
  context.stockItems[0]!.reservedLengthMm = 40.001;
  invalid(context, plan, 'length_capacity');
});

test('whole remnants are reserved and reusable tails are not counted as waste', () => {
  const { context, plan } = fixture();
  context.stockItems[0]!.isRemnant = true;
  const summary = valid(context, plan);
  assert.equal(summary.reservations[0]!.reservedLengthMm, 100);
  assert.equal(summary.inputAreaMm2, '11800.000000');
  assert.equal(summary.reusableAreaMm2, '8700.000000');
  assert.equal(summary.wasteAreaMm2, '600.000000');
  assert.equal(summary.newRollCount, 0);
  context.stockItems[0]!.reservedLengthMm = 0.001;
  invalid(context, plan, 'reserved_remnant');
});

test('remnant reuse checks both dimensions without rotation or combining pieces', () => {
  for (const [width, length, expected] of [
    [22, 10, true],
    [22.001, 10, false],
    [22, 10.001, false],
    [10, 22, false],
  ] as const) {
    const { context, plan } = fixture();
    context.settings.minimumRemnantWidthMm = width;
    context.settings.minimumRemnantLengthMm = length;
    const leftover = valid(context, plan).leftovers.find(
      (item) => item.kind === 'shortening',
    )!;
    assert.equal(leftover.reusable, expected);
    assert.equal(leftover.quantity, 2);
  }
});

test('missing, excessive, and repeated assignments are rejected', () => {
  for (const quantity of [1, 3]) {
    const { context, plan } = fixture();
    plan.drops[0]!.items[1]!.quantity = quantity;
    invalid(context, plan, 'quantity_mismatch');
  }
  const { context, plan } = fixture();
  plan.drops[0]!.items.push({ requirementId: id(2), quantity: 1 });
  invalid(context, plan, 'duplicate_requirement');
});

test('unknown references, consumed stock, and color mismatch are rejected', () => {
  const cases: [
    string,
    (context: CuttingContext, plan: CuttingPlan) => void,
  ][] = [
    [
      'unknown_stock',
      (_, p) => {
        p.drops[0]!.stockItemId = id(99);
      },
    ],
    [
      'unknown_requirement',
      (_, p) => {
        p.drops[0]!.items[0]!.requirementId = id(99);
      },
    ],
    [
      'consumed_stock',
      (c) => {
        c.stockItems[0]!.consumedAt = '2026-09-15T00:00:00Z';
      },
    ],
    [
      'color_mismatch',
      (c) => {
        c.stockItems[0]!.fabricColorId = id(99);
      },
    ],
  ];
  for (const [code, change] of cases) {
    const { context, plan } = fixture();
    change(context, plan);
    invalid(context, plan, code);
  }
});

test('duplicate snapshot identifiers are rejected, including differently cased UUIDs', () => {
  const { context, plan } = fixture();
  context.requirements[0]!.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  context.requirements.push({
    ...context.requirements[0]!,
    id: context.requirements[0]!.id.toUpperCase(),
  });
  invalid(context, plan, 'duplicate_id');
  context.requirements.pop();
  context.stockItems.push({ ...context.stockItems[0]! });
  invalid(context, plan, 'duplicate_id');
});

test('malformed dimensions, unsupported layout fields, and noninteger quantities fail at the boundary', () => {
  const { context, plan } = fixture();
  for (const value of [NaN, Infinity, -1, 0, 0.0001]) {
    const changed = structuredClone(context);
    changed.requirements[0]!.widthMm = value;
    invalid(changed, plan, 'invalid_input');
  }
  invalid(context, { ...plan, rotated: true }, 'invalid_input');
  plan.drops[0]!.items[0]!.quantity = 1.5;
  invalid(context, plan, 'invalid_input');
});

test('large three-decimal dimensions retain exact area beyond safe integer multiplication', () => {
  const { context, plan } = fixture();
  context.requirements = [
    {
      ...context.requirements[0]!,
      widthMm: 999999999.997,
      lengthMm: 999999999.999,
      lengthAllowanceMm: 0,
    },
  ];
  context.stockItems[0]!.widthMm = 999999999.999;
  context.stockItems[0]!.remainingLengthMm = 999999999.999;
  context.settings.edgeTrimMm = 0.001;
  plan.drops[0]!.lengthMm = 999999999.999;
  plan.drops[0]!.items = [{ requirementId: id(1), quantity: 1 }];
  const summary = valid(context, plan);
  assert.equal(summary.inputAreaMm2, '999999999998000000.000001');
  assert.equal(summary.wasteAreaMm2, '1999999.999998');
});

test('validation does not mutate inputs or accept worker-provided accounting', () => {
  const { context, plan } = fixture();
  const before = structuredClone({ context, plan });
  valid(context, plan);
  assert.deepEqual({ context, plan }, before);
  invalid(context, { ...plan, wasteAreaMm2: '0' }, 'invalid_input');
});
