import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import type { SessionsRepository } from './sessions.repository.js';
import { SessionsService } from './sessions.service.js';

test('production sessions are issued behind a TLS-terminating host that Express does not trust', async () => {
  const sessions = new SessionsService(
    {
      store: new session.MemoryStore(),
      isAvailable: () => true,
    } as unknown as SessionsRepository,
    new ConfigService({
      NODE_ENV: 'production',
      AUTH_SESSION_SECRET: 'test-secret-that-is-at-least-32-characters',
    }),
  );
  const app = express();
  // Matches the deployed configuration: forwarded headers are not trusted.
  app.set('trust proxy', []);
  app.use(sessions.middleware);
  app.get('/', (incoming, response) => {
    incoming.session.expiresAt = Date.now() + 60_000;
    response.end();
  });

  const forwarded = await request(app)
    .get('/')
    .set('X-Forwarded-Proto', 'https')
    .expect(200);
  const cookies = forwarded.headers['set-cookie'] as unknown as string[];
  assert.equal(cookies.length, 1);
  assert.match(cookies[0]!, /^__Host-roller_bay\.sid=/);
  assert.match(cookies[0]!, /; Secure/);

  // A plain-HTTP hop still never receives the Secure cookie.
  const plain = await request(app).get('/').expect(200);
  assert.equal(plain.headers['set-cookie'], undefined);
});
