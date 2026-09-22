import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import 'reflect-metadata';
import { stubUnitOfWork } from '../../testing/unit-of-work.js';
import { UserEmailConflictError } from './users.errors.js';
import { UsersRepository, type UserRecord } from './users.repository.js';
import { UsersService } from './users.service.js';

const profile = {
  microsoftSubjectId: 'subject',
  name: 'User',
  email: 'user@example.com',
};

test('Microsoft profile conflict retries in autocommit and preserves the existing identity', async (t) => {
  const current: UserRecord = {
    ...profile,
    id: randomUUID(),
    role: 'user',
    stations: [],
    isActive: true,
    createdAt: new Date(),
    measurementUnits: {},
    colorTheme: 'slate',
  };
  const calls: string[] = [];
  const repository = {
    upsertMicrosoftProfile: async () => {
      calls.push('upsert');
      throw new UserEmailConflictError();
    },
    updateMicrosoftProfile: async () => {
      calls.push('update');
      return current;
    },
  } as unknown as UsersRepository;
  const unitOfWork = stubUnitOfWork({});
  const transaction = t.mock.method(unitOfWork, 'transaction', () => {
    throw new Error('Profile retries must use autocommit');
  });
  const service = new UsersService(
    unitOfWork,
    repository,
    new ConfigService({}),
  );
  const result = await service.synchronizeMicrosoftProfile(profile);
  assert.equal(result.id, current.id);
  assert.deepEqual(calls, ['upsert', 'update']);
  assert.equal(transaction.mock.callCount(), 0);
});

test('profile retry distinguishes a missing subject from an unrelated storage failure', async () => {
  for (const unrelatedFailure of [false, true]) {
    const repository = {
      upsertMicrosoftProfile: async () => {
        throw new UserEmailConflictError();
      },
      updateMicrosoftProfile: async () => {
        if (unrelatedFailure) throw new Error('Connection lost');
        return undefined;
      },
    } as unknown as UsersRepository;
    const service = new UsersService(
      stubUnitOfWork({}),
      repository,
      new ConfigService({}),
    );
    await assert.rejects(
      service.synchronizeMicrosoftProfile(profile),
      unrelatedFailure ? ServiceUnavailableException : ConflictException,
    );
  }
});
