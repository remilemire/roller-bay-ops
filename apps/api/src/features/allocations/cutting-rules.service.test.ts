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
} from '@roller-bay/shared/allocations';
import {
  environmentSchema,
  type Environment,
} from '../../config/environment.js';
import { CuttingRulesService } from './cutting-rules.service.js';
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
  assert.deepEqual(rules.apply([requirement], first), first);
  const expanded = rules.apply(
    [requirement, { id: randomUUID(), lengthMm: 2000 }],
    first,
  );
  assert.equal(expanded.requirements[1]!.lengthAllowanceMm, 254);
  assert.equal(
    rules.apply([requirement]).requirements[0]!.lengthAllowanceMm,
    508,
  );
});

test('legacy snapshots keep individual allowances, including zero, while filling unfinished draft rules', () => {
  const rules = new CuttingRulesService(new ConfigService({ ...defaults }));
  const requirements = [
    { id: randomUUID() },
    { id: randomUUID() },
    { id: randomUUID() },
  ];
  const saved = {
    settings: {
      edgeTrimMm: 10,
      minimumRemnantWidthMm: null,
      minimumRemnantLengthMm: 20,
    },
    requirements: requirements.map((item, index) => ({
      ...item,
      lengthAllowanceMm: [0, '457.200', null][index]!,
    })),
  };
  const result = rules.apply(requirements, saved);
  assert.deepEqual(
    result.requirements.map((item) => item.lengthAllowanceMm),
    [0, 457.2, 254],
  );
  assert.deepEqual(result.settings, {
    edgeTrimMm: 10,
    minimumRemnantWidthMm: 1524,
    minimumRemnantLengthMm: 20,
    dropAllowanceMm: 254,
  });
});

test('write and preview contracts reject client cutting rules while response snapshots retain them', () => {
  const context = fixture();
  const requirements = context.requirements.map(
    ({ id, fabricColorId, widthMm, lengthMm, quantity }) => ({
      id,
      fabricColorId,
      widthMm,
      lengthMm,
      quantity,
    }),
  );
  const plan = {
    cuts: [
      {
        stockItemId: context.stockItems[0]!.id,
        lengthMm: 3,
        items: [{ requirementId: requirements[0]!.id, quantity: 2 }],
      },
    ],
  };
  for (const schema of [
    createAllocationSchema,
    validateAllocationSchema,
    optimizeAllocationSchema,
    allocationDraftInputSchema,
  ]) {
    const input =
      schema === createAllocationSchema || schema === allocationDraftInputSchema
        ? { orderNumber: 'ORDER', requirements, plan }
        : schema === validateAllocationSchema
          ? { requirements, plan }
          : { requirements };
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
  }
  const snapshot = allocationDraftDataSchema.parse({
    requirements: context.requirements,
    settings: { ...context.settings, dropAllowanceMm: 254 },
  });
  assert.equal(snapshot.settings.dropAllowanceMm, 254);
  assert.deepEqual(snapshot.requirements, context.requirements);
});
