import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import {
  allocationDraftInputSchema,
  allocationDraftDataSchema,
  createAllocationSchema,
  optimizeAllocationSchema,
  validateAllocationSchema,
  requirementInput,
} from '@roller-bay/shared/allocations';
import {
  environmentSchema,
  type Environment,
} from '../../config/environment.js';
import {
  CuttingRulesService,
  planCutLengths,
} from './cutting-rules.service.js';
import { fixture } from './optimizer/optimizer.fixtures.js';

const defaults = {
  CUTTING_EDGE_TRIM_MM: 25.4,
  CUTTING_MINIMUM_REMNANT_WIDTH_MM: 1524,
  CUTTING_MINIMUM_REMNANT_LENGTH_MM: 1524,
  CUTTING_DROP_ALLOWANCE_MM: 254,
};

test('cutting environment values use millimetres and reject invalid ranges or precision', () => {
  for (const [key, value] of Object.entries(defaults)) {
    const schema = environmentSchema.shape[key as keyof typeof defaults];
    assert.equal(schema.parse(undefined), value);
    assert.equal(schema.parse(String(value)), value);
    for (const invalid of ['', '-1', 'NaN', '1.0001', '1000000000'])
      assert.equal(
        schema.safeParse(invalid).success,
        false,
        `${key}: ${invalid}`,
      );
    assert.equal(
      schema.safeParse('0').success,
      key === 'CUTTING_DROP_ALLOWANCE_MM',
    );
  }
});

test('new plans receive configured rules; edits retain their snapshot and never accumulate allowance', () => {
  const config = new ConfigService<Environment, true>({ ...defaults });
  const rules = new CuttingRulesService(config);
  const requirement = { id: randomUUID(), lengthMm: 1000 };
  const first = rules.apply([requirement]);
  assert.deepEqual(first.settings, {
    edgeTrimMm: 25.4,
    minimumRemnantWidthMm: 1524,
    minimumRemnantLengthMm: 1524,
    dropAllowanceMm: 254,
  });
  assert.equal(first.requirements[0]!.lengthMm, 1000);
  assert.equal(first.requirements[0]!.lengthAllowanceMm, 254);
  config.set('CUTTING_EDGE_TRIM_MM', 50.8);
  config.set('CUTTING_DROP_ALLOWANCE_MM', 508);
  // A plan keeps the rules it was saved with, for every blind it assigns.
  assert.deepEqual(rules.apply([requirement], first.settings), first);
  const expanded = rules.apply(
    [requirement, { id: randomUUID(), lengthMm: 2000 }],
    first.settings,
  );
  assert.equal(expanded.requirements[1]!.lengthAllowanceMm, 254);
  assert.equal(
    rules.apply([requirement]).requirements[0]!.lengthAllowanceMm,
    508,
  );
});

test('saved rules apply to every blind, with unfinished draft rules filled from configuration', () => {
  const rules = new CuttingRulesService(new ConfigService({ ...defaults }));
  const requirements = [{ id: randomUUID() }, { id: randomUUID() }];
  const result = rules.apply(requirements, {
    edgeTrimMm: 10,
    minimumRemnantWidthMm: null,
    minimumRemnantLengthMm: 20,
    // Zero is an allowance, not a missing one.
    dropAllowanceMm: 0,
  });
  assert.deepEqual(
    result.requirements.map((item) => item.lengthAllowanceMm),
    [0, 0],
  );
  assert.deepEqual(result.settings, {
    edgeTrimMm: 10,
    minimumRemnantWidthMm: 1524,
    minimumRemnantLengthMm: 20,
    dropAllowanceMm: 0,
  });
});

test('write and preview contracts reject client cutting rules while response snapshots retain them', () => {
  const context = fixture();
  const workOrderId = randomUUID();
  const plan = {
    cuts: [
      {
        stockItemId: context.stockItems[0]!.id,
        items: [{ requirementId: context.requirements[0]!.id, quantity: 2 }],
      },
    ],
  };
  // Blinds are sent without an allowance; the server supplies the plan's.
  const requirements = context.requirements.map(requirementInput);
  for (const [schema, input] of [
    [createAllocationSchema, { workOrderId, requirements, plan }],
    [validateAllocationSchema, { requirements, plan }],
    [optimizeAllocationSchema, { requirements }],
    [allocationDraftInputSchema, { workOrderId, requirements, plan }],
  ] as const) {
    assert.equal(schema.safeParse(input).success, true);
    assert.equal(
      schema.safeParse({ ...input, settings: context.settings }).success,
      false,
    );
    assert.equal(
      schema.safeParse({ ...input, requirements: context.requirements })
        .success,
      false,
    );
    if ('plan' in input)
      assert.equal(
        schema.safeParse({
          ...input,
          plan: { cuts: [{ ...plan.cuts[0], lengthMm: 3 }] },
        }).success,
        false,
      );
  }
  const snapshot = allocationDraftDataSchema.parse({
    requirements: context.requirements,
    settings: { ...context.settings, dropAllowanceMm: 254 },
  });
  assert.equal(snapshot.settings.dropAllowanceMm, 254);
  assert.deepEqual(snapshot.requirements, context.requirements);
});

test('cut length is the longest assigned drop plus its own allowance, unknown while a draft blind lacks a drop', () => {
  const [short, long, blank] = [randomUUID(), randomUUID(), randomUUID()];
  const requirements = [
    { id: short, lengthMm: 1000, lengthAllowanceMm: 457.2 },
    { id: long, lengthMm: 1200.001, lengthAllowanceMm: 254 },
    { id: blank, lengthMm: null, lengthAllowanceMm: 254 },
  ];
  const { cuts } = planCutLengths(requirements, {
    cuts: [
      { stockItemId: 'a', items: [{ requirementId: short, quantity: 2 }] },
      {
        stockItemId: 'a',
        items: [{ requirementId: short }, { requirementId: long }],
      },
      { stockItemId: null, items: [] },
      { items: [{ requirementId: long }, { requirementId: blank }] },
      { items: [{ requirementId: randomUUID() }] },
    ],
  });
  // The shorter drop with the larger allowance is the longer adjusted piece.
  assert.deepEqual(
    cuts.map((cut) => cut.lengthMm),
    [1457.2, 1457.2, null, null, null],
  );
  assert.deepEqual(cuts[0], {
    stockItemId: 'a',
    items: [{ requirementId: short, quantity: 2 }],
    lengthMm: 1457.2,
  });
});
