import 'reflect-metadata';
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { OAuthTransactionsRepository } from './oauth-transactions.repository.js';
import {
  OAuthTransactionsService,
  OAUTH_TRANSACTION_TTL_SECONDS,
} from './oauth-transactions.service.js';
import type { OAuthTransaction } from './oauth-transaction.schema.js';

let module: TestingModule;
let service: OAuthTransactionsService;
let stored: { browser: string; transaction: OAuthTransaction } | undefined;
let returned: unknown;
let failure: Error | undefined;
let reads = 0;
const state = 's'.repeat(43);

before(async () => {
  // The transaction service only needs its repository, not Express or sessions.
  module = await Test.createTestingModule({
    providers: [
      OAuthTransactionsService,
      {
        provide: OAuthTransactionsRepository,
        useValue: {
          create: async (browser: string, transaction: OAuthTransaction) => {
            if (failure) throw failure;
            stored = { browser, transaction };
          },
          consume: async () => {
            reads++;
            if (failure) throw failure;
            return returned;
          },
        },
      },
    ],
  }).compile();
  service = module.get(OAuthTransactionsService);
});

after(async () => module.close());

test('creates a browser-bound transaction with its own fixed lifetime', async () => {
  const before = Date.now();
  await service.create('browser-id', {
    state,
    nonce: 'nonce',
    verifier: 'verifier',
  });
  assert.equal(stored?.browser, 'browser-id');
  assert.equal(stored?.transaction.state, state);
  assert.equal(stored?.transaction.nonce, 'nonce');
  assert.equal(stored?.transaction.verifier, 'verifier');
  assert.ok(
    stored!.transaction.expiresAt >=
      before + OAUTH_TRANSACTION_TTL_SECONDS * 1000,
  );
  assert.ok(
    stored!.transaction.expiresAt <=
      Date.now() + OAUTH_TRANSACTION_TTL_SECONDS * 1000,
  );
});

test('accepts a valid repository result and rejects missing, mismatched, malformed, or expired transactions', async () => {
  const valid = {
    state,
    nonce: 'nonce',
    verifier: 'verifier',
    expiresAt: Date.now() + 60000,
  };
  returned = valid;
  assert.deepEqual(await service.consume('browser-id', state), valid);
  for (const value of [
    null,
    {},
    { ...valid, state: 'wrong' },
    { ...valid, expiresAt: Date.now() - 1 },
    { ...valid, nonce: 1 },
  ]) {
    returned = value;
    await assert.rejects(
      service.consume('browser-id', state),
      UnauthorizedException,
    );
  }
});

test('rejects malformed state before touching storage', async () => {
  const before = reads;
  for (const value of ['', '../key', 'a'.repeat(129)])
    await assert.rejects(
      service.consume('browser-id', value),
      UnauthorizedException,
    );
  assert.equal(reads, before);
});

test('storage failures fail closed without exposing backend errors', async () => {
  failure = new Error('Internal Redis detail');
  try {
    for (const operation of [
      () =>
        service.create('browser-id', {
          state,
          nonce: 'nonce',
          verifier: 'verifier',
        }),
      () => service.consume('browser-id', state),
    ])
      await assert.rejects(operation(), (error: unknown) => {
        assert.ok(error instanceof ServiceUnavailableException);
        assert.doesNotMatch(error.message, /Internal Redis detail/);
        return true;
      });
  } finally {
    failure = undefined;
  }
});
