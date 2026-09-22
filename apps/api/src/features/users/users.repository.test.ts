import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { drizzle } from 'drizzle-orm/node-postgres';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, mock, test } from 'node:test';
import { Pool } from 'pg';
import 'reflect-metadata';
import { DatabaseService } from '../../database/database.service.js';
import { stubUnitOfWork } from '../../testing/unit-of-work.js';
import { UnitOfWork } from '../../unit-of-work/unit-of-work.js';
import { UserEmailConflictError } from './users.errors.js';
import { UsersRepository } from './users.repository.js';
import { UsersService } from './users.service.js';

const pool = new Pool();
let failure: unknown;
let module: TestingModule;
let repository: UsersRepository;
let service: UsersService;
const profile = {
  microsoftSubjectId: 'subject',
  name: 'Test User',
  email: 'user@example.com',
};

before(async () => {
  // Exercise Drizzle's actual error wrapping while replacing only the driver IO.
  mock.method(pool, 'query', async () => {
    throw failure;
  });
  module = await Test.createTestingModule({
    providers: [
      {
        provide: UsersRepository,
        inject: [DatabaseService],
        useFactory: (database: DatabaseService) =>
          new UsersRepository(database.db),
      },
      { provide: UnitOfWork, useValue: stubUnitOfWork({}) },
      UsersService,
      { provide: ConfigService, useValue: new ConfigService({}) },
      {
        provide: DatabaseService,
        useValue: { db: drizzle(pool) },
      },
    ],
  }).compile();
  repository = module.get(UsersRepository);
  service = module.get(UsersService);
});

after(async () => {
  mock.restoreAll();
  await module.close();
  await pool.end();
});

test('repository translates only the named email constraint into a typed conflict', async () => {
  for (const error of [
    { code: '23505', constraint: 'users_email_unique' },
    new Error('driver wrapper', {
      cause: { code: '23505', constraint: 'users_email_unique' },
    }),
  ]) {
    failure = error;
    await assert.rejects(
      repository.upsertMicrosoftProfile(profile),
      (error: unknown) => {
        assert.ok(error instanceof UserEmailConflictError);
        assert.ok(error.cause instanceof Error);
        return true;
      },
    );
    await assert.rejects(
      service.synchronizeMicrosoftProfile(profile),
      ConflictException,
    );
  }
});

test('measurement unit updates report storage failures as unavailable', async () => {
  failure = new Error('Connection failed');
  const id = randomUUID();
  await assert.rejects(
    repository.setMeasurementUnits(id, { rollWidth: 'mm' }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.cause, failure);
      return true;
    },
  );
  await assert.rejects(
    service.setMeasurementUnits(id, { rollWidth: 'mm' }),
    ServiceUnavailableException,
  );
});

test('other database failures are not mislabeled as email conflicts', async () => {
  const cycle: { cause?: unknown } = {};
  cycle.cause = { cause: cycle };
  for (const error of [
    { code: '23505', constraint: 'users_pkey' },
    { code: '23505', constraint: 'users_microsoft_subject_id_unique' },
    { code: '23505' },
    { code: '23502', constraint: 'users_email_unique' },
    new Error('Connection failed'),
    cycle,
    null,
  ]) {
    failure = error;
    await assert.rejects(
      repository.upsertMicrosoftProfile(profile),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.ok(!(error instanceof UserEmailConflictError));
        assert.equal(error.cause, failure);
        return true;
      },
    );
    await assert.rejects(
      service.synchronizeMicrosoftProfile(profile),
      ServiceUnavailableException,
    );
  }
});
