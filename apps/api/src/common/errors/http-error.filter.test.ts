import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import {
  BadRequestException,
  Logger,
  ServiceUnavailableException,
  type ArgumentsHost,
} from '@nestjs/common';
import { HttpErrorFilter } from './http-error.filter.js';

function responseDouble(headersSent = false) {
  const calls: { status?: number; body?: unknown; ended: boolean } = {
    ended: false,
  };
  const response = {
    headersSent,
    status(code: number) {
      calls.status = code;
      return this;
    },
    json(body: unknown) {
      calls.body = body;
      return this;
    },
    end() {
      calls.ended = true;
      return this;
    },
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'GET',
        originalUrl: '/api/stock-items?search=secret',
      }),
      getResponse: () => response,
    }),
  } as ArgumentsHost;
  return { host, calls };
}

function captureLogs(t: TestContext) {
  const logged: unknown[][] = [];
  t.mock.method(Logger.prototype, 'error', (...args: unknown[]) => {
    logged.push(args);
  });
  return logged;
}

test('server faults are logged with their cause chain and answered with curated copy', (t) => {
  const logged = captureLogs(t);
  const { host, calls } = responseDouble();
  new HttpErrorFilter().catch(
    new ServiceUnavailableException('Stock storage is unavailable.', {
      cause: new Error('password authentication failed for user "roller"'),
    }),
    host,
  );
  assert.deepEqual(calls, {
    status: 503,
    body: { statusCode: 503, message: 'Stock storage is unavailable.' },
    ended: false,
  });
  assert.equal(logged.length, 1);
  assert.equal(logged[0]![0], 'GET /api/stock-items -> 503');
  assert.match(String(logged[0]![1]), /password authentication failed/);
});

test('client errors are answered without logging', (t) => {
  const logged = captureLogs(t);
  const { host, calls } = responseDouble();
  new HttpErrorFilter().catch(
    new BadRequestException('Provide a width.'),
    host,
  );
  assert.deepEqual(calls, {
    status: 400,
    body: { statusCode: 400, message: 'Provide a width.' },
    ended: false,
  });
  assert.equal(logged.length, 0);
});

test('a response that already started is ended instead of rewritten', (t) => {
  const logged = captureLogs(t);
  const { host, calls } = responseDouble(true);
  new HttpErrorFilter().catch(new Error('stream broke'), host);
  assert.deepEqual(calls, { ended: true });
  assert.equal(logged.length, 1);
});
