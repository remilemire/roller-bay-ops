import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { catalogQuery } from './catalog.persistence.js';
import { catalogOperation } from './catalog.operation.js';
import {
  createFabricColorSchema,
  updateFabricColorSchema,
} from '@roller-bay/shared/fabric-catalog';

test('catalog driver errors map to conflict, missing reference, or unavailable without leaking details', async () => {
  const failures = [
    {
      cause: { code: '23505', constraint: 'fabric_colors_code_unique' },
      deleting: false,
      expected: ConflictException,
    },
    { cause: { code: '23503' }, deleting: false, expected: NotFoundException },
    { cause: { code: '23503' }, deleting: true, expected: ConflictException },
    {
      cause: { code: '23505', constraint: 'manufacturers_pkey' },
      deleting: false,
      expected: ServiceUnavailableException,
    },
    {
      cause: { code: '23505' },
      deleting: false,
      expected: ServiceUnavailableException,
    },
    {
      cause: new Error('database credentials and query details'),
      deleting: false,
      expected: ServiceUnavailableException,
    },
  ];
  for (const { cause, deleting, expected } of failures) {
    await assert.rejects(
      catalogOperation(() =>
        catalogQuery(async () => {
          throw new Error('query details', { cause });
        }, deleting),
      ),
      (error: unknown) => {
        assert.ok(error instanceof expected);
        assert.doesNotMatch(error.message, /credentials|query details/);
        return true;
      },
    );
  }
  const cycle: { cause?: unknown } = {};
  cycle.cause = cycle;
  await assert.rejects(
    catalogOperation(() =>
      catalogQuery(async () => {
        throw cycle;
      }),
    ),
    ServiceUnavailableException,
  );
});

test('catalog contracts preserve thousandths and reject extra precision or unintended updates', () => {
  const input = {
    code: ' ab-12 ',
    materialId: '11111111-1111-4111-8111-111111111111',
    thicknessMm: 0.123,
  };
  assert.equal(createFabricColorSchema.parse(input).code, 'AB-12');
  for (const thicknessMm of [0.001, 0.123, 0.456, 1.001, 9999999.999])
    assert.equal(
      createFabricColorSchema.parse({ ...input, thicknessMm }).thicknessMm,
      thicknessMm,
    );
  for (const thicknessMm of [0, -1, 0.1234, 10000000, Infinity, NaN, '0.123'])
    assert.equal(
      createFabricColorSchema.safeParse({ ...input, thicknessMm }).success,
      false,
    );
  for (const update of [
    {},
    { role: 'admin' },
    { code: 'VALID', manufacturerId: input.materialId },
    { thicknessMm: null },
  ])
    assert.equal(updateFabricColorSchema.safeParse(update).success, false);
});
