import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { HealthService } from './health.service.js';
import type { DatabaseService } from '../../database/database.service.js';
import type { RedisService } from '../../redis/redis.service.js';
import type { Environment } from '../../config/environment.js';

function fixture(probe: () => Promise<void> = async () => {}) {
  const redis = {
    client: {
      isReady: true,
      withAbortSignal: () => ({ ping: async () => 'PONG' }),
    },
  };
  const config = new ConfigService<Environment, true>({
    SOLVER_URL: 'http://127.0.0.1:8001',
    SOLVER_API_KEY: 'x'.repeat(32),
  });
  const health = new HealthService(
    { checkConnection: probe } as DatabaseService,
    redis as unknown as RedisService,
    config,
  );
  return { health, redis };
}

test('readiness checks storage and does not require the solver', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('solver offline');
  });
  const { health } = fixture();
  assert.deepEqual(await health.readiness(), { status: 'ok' });
  await assert.rejects(health.solver(), ServiceUnavailableException);
});

test('readiness hides driver errors and fails for either dependency', async () => {
  const { health, redis } = fixture();
  redis.client.isReady = false;
  await assert.rejects(health.readiness(), ServiceUnavailableException);
  const failed = fixture(async () => {
    throw new Error('postgres://private-secret');
  });
  await assert.rejects(failed.health.readiness(), (error: Error) => {
    assert.equal(error.message, 'Application dependencies unavailable.');
    return true;
  });
});

test('concurrent readiness calls share the pending database probe', async () => {
  let calls = 0;
  let finish!: () => void;
  const { health } = fixture(() => {
    calls++;
    return new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  const checks = [health.readiness(), health.readiness()];
  assert.equal(calls, 1);
  finish();
  await Promise.all(checks);
  const next = health.readiness();
  assert.equal(calls, 2);
  finish();
  await next;
});

test('solver monitor reports its own status', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('{"status":"ok"}'),
  );
  assert.deepEqual(await fixture().health.solver(), { status: 'ok' });
});
