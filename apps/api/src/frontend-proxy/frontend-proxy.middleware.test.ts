import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FRONTEND_PROXY_CLIENT_IP_HEADER,
  FRONTEND_PROXY_SECRET_HEADER,
} from '@roller-bay/shared/frontend-proxy';
import type { Request, Response } from 'express';
import type { Environment } from '../config/environment.js';
import { FrontendProxyMiddleware } from './frontend-proxy.middleware.js';

const secret = 'proxy-secret-that-is-at-least-32-characters';

function run(configured: string | undefined, headers: Record<string, string>) {
  const middleware = new FrontendProxyMiddleware(
    new ConfigService({
      API_PROXY_SECRET: configured,
    }) as ConfigService<Environment, true>,
  );
  const request = {
    get: (name: string) => headers[name.toLowerCase()],
  } as Request;
  let continued = false;
  middleware.use(request, {} as Response, () => {
    continued = true;
  });
  assert.equal(continued, true);
  return request.verifiedClientIp;
}

test('without a configured secret the reported client address is never read', () => {
  assert.equal(
    run(undefined, {
      [FRONTEND_PROXY_SECRET_HEADER]: secret,
      [FRONTEND_PROXY_CLIENT_IP_HEADER]: '198.51.100.7',
    }),
    undefined,
  );
});

test('requests without the exact secret are rejected', () => {
  for (const presented of [
    undefined,
    '',
    'short',
    `${secret}x`,
    secret.toUpperCase(),
  ])
    assert.throws(
      () =>
        run(secret, {
          ...(presented === undefined
            ? {}
            : { [FRONTEND_PROXY_SECRET_HEADER]: presented }),
          [FRONTEND_PROXY_CLIENT_IP_HEADER]: '198.51.100.7',
        }),
      ForbiddenException,
    );
});

test('an authenticated proxy may report a valid client address', () => {
  for (const ip of ['198.51.100.7', '2001:db8:abcd:1200::1'])
    assert.equal(
      run(secret, {
        [FRONTEND_PROXY_SECRET_HEADER]: secret,
        [FRONTEND_PROXY_CLIENT_IP_HEADER]: ip,
      }),
      ip,
    );
  for (const invalid of [undefined, '', 'unknown', '198.51.100.7, 10.0.0.1'])
    assert.equal(
      run(secret, {
        [FRONTEND_PROXY_SECRET_HEADER]: secret,
        ...(invalid === undefined
          ? {}
          : { [FRONTEND_PROXY_CLIENT_IP_HEADER]: invalid }),
      }),
      undefined,
    );
});
