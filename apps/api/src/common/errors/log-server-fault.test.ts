import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  describeCauseChain,
  logServerFault,
  requestPath,
} from './log-server-fault.js';

test('server faults are logged by method and path with the cause chain; client errors are not', (t) => {
  const logged: unknown[][] = [];
  t.mock.method(Logger.prototype, 'error', (...args: unknown[]) => {
    logged.push(args);
  });
  const logger = new Logger('test');
  const request = {
    method: 'GET',
    originalUrl: '/api/auth/callback?code=secret&state=private',
  };
  logServerFault(logger, request, 400, new Error('client detail'));
  logServerFault(logger, request, 404, undefined);
  assert.equal(logged.length, 0);
  logServerFault(
    logger,
    request,
    503,
    new ServiceUnavailableException('Session storage is unavailable.', {
      cause: new Error('connect ECONNREFUSED 127.0.0.1:6379'),
    }),
  );
  assert.equal(logged.length, 1);
  assert.equal(logged[0]![0], 'GET /api/auth/callback -> 503');
  assert.match(String(logged[0]![1]), /Session storage is unavailable\./);
  assert.match(
    String(logged[0]![1]),
    /\nCaused by: Error: connect ECONNREFUSED/,
  );
});

test('cause chains are described with stacks and without serialising foreign objects', () => {
  const chain = describeCauseChain(
    new ServiceUnavailableException('Stock storage is unavailable.', {
      cause: Object.assign(new Error('Failed query: select 1'), {
        cause: new Error('connect ECONNREFUSED 127.0.0.1:5432'),
      }),
    }),
  );
  assert.match(chain, /Stock storage is unavailable\./);
  assert.match(chain, /\nCaused by: Error: Failed query: select 1/);
  assert.match(chain, /\nCaused by: Error: connect ECONNREFUSED/);
  assert.match(chain, /log-server-fault\.test/);

  const foreign = describeCauseChain(
    new Error('boom', {
      cause: {
        statusCode: 413,
        code: 'E_TOO_LARGE',
        type: 'entity.too.large',
        body: '{"secret":1}',
      },
    }),
  );
  assert.match(foreign, /\nCaused by: Object code=E_TOO_LARGE$/);
  assert.doesNotMatch(foreign, /secret/);

  const first: Error & { cause?: unknown } = new Error('first');
  const second = new Error('second', { cause: first });
  first.cause = second;
  assert.equal(describeCauseChain(second).split('\nCaused by: ').length, 2);
  assert.equal(describeCauseChain('plain text'), 'plain text');
});

test('request paths for the log drop the query string', () => {
  assert.equal(
    requestPath({ originalUrl: '/api/auth/callback?code=secret&state=s' }),
    '/api/auth/callback',
  );
  assert.equal(requestPath({ url: '/api/x' }), '/api/x');
  assert.equal(requestPath({}), '');
});
