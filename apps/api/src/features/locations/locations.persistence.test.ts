import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { locationsQuery } from './locations.persistence.js';
import { locationsOperation } from './locations.operation.js';

test('locations driver errors map to conflict, missing reference, or unavailable without leaking details', async () => {
  const failures = [
    {
      cause: { code: '23505', constraint: 'locations_section_label_unique' },
      deleting: false,
      expected: ConflictException,
    },
    ...[
      'location_zones_name_unique',
      'location_sections_zone_label_unique',
    ].map((constraint) => ({
      cause: { code: '23505', constraint },
      deleting: false,
      expected: ConflictException,
    })),
    { cause: { code: '23503' }, deleting: false, expected: NotFoundException },
    { cause: { code: '23503' }, deleting: true, expected: ConflictException },
    {
      cause: { code: '23505', constraint: 'location_zones_pkey' },
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
      locationsOperation(() =>
        locationsQuery(async () => {
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
    locationsOperation(() =>
      locationsQuery(async () => {
        throw cycle;
      }),
    ),
    ServiceUnavailableException,
  );
});
