import { testCorrections } from '../audit/corrections.integration-cases.js';
import { AuditModule } from '../audit/audit.module.js';
import { AllocationsModule } from '../allocations/allocations.module.js';
import { testAllocations } from '../allocations/allocations.integration-cases.js';
import { testStockReceipts } from '../stock-receipts/stock-receipts.integration-cases.js';
import { StockReceiptsModule } from '../stock-receipts/stock-receipts.module.js';
import { testOrderSchedule } from '../order-schedule/order-schedule.integration-cases.js';
import { OrderScheduleModule } from '../order-schedule/order-schedule.module.js';
import 'reflect-metadata';
import { testUserRoles } from '../users/users.integration-cases.js';
import { copyApplicationTables } from '../../database/testing/copy-application-tables.js';
import { FabricCatalogModule } from '../fabric-catalog/fabric-catalog.module.js';
import { testCatalog } from '../fabric-catalog/catalog.integration-cases.js';
import { LocationsModule } from '../locations/locations.module.js';
import { testLocations } from '../locations/locations.integration-cases.js';
import { StockItemsModule } from '../stock-items/stock-items.module.js';
import { testStockItems } from '../stock-items/stock-items.integration-cases.js';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import {
  currentUserSchema,
  type LoginErrorCode,
} from '@roller-bay/shared/auth';
import { environmentSchema } from '../../config/environment.js';
import { RedisService } from '../../redis/redis.service.js';
import { RateLimitingModule } from '../../rate-limiting/rate-limiting.module.js';
import { RATE_LIMIT_KEY_PREFIX } from '../../rate-limiting/rate-limiting.service.js';
import { ErrorsModule } from '../../common/errors/errors.module.js';
import { PassthroughExpressAdapter } from '../../common/errors/express.adapter.js';
import { UsersService } from '../users/users.service.js';
import { HealthModule } from '../health/health.module.js';
import { AuthModule } from './auth.module.js';
import { MicrosoftService } from './microsoft.service.js';
import { MicrosoftAccountNotEligibleException } from './microsoft.errors.js';
import { SessionsService } from './sessions/sessions.service.js';
import {
  SESSION_PREFIX,
  SessionsRepository,
} from './sessions/sessions.repository.js';
import type { SessionData } from 'express-session';

const enabled = process.env.AUTH_INTEGRATION_TESTS === '1';

test(
  'auth integration with real Redis and isolated PostgreSQL tables',
  { skip: !enabled, timeout: 90000 },
  async (t) => {
    assert.ok(
      process.env.TEST_DATABASE_URL,
      'Set TEST_DATABASE_URL to a migrated local test database.',
    );
    assert.ok(process.env.TEST_REDIS_URL, 'Set TEST_REDIS_URL to local Redis.');
    const schema = `auth_test_${randomUUID().replaceAll('-', '')}`;
    const rateLimitPrefix = `roller-bay:test:rate-limit:${randomUUID()}:`;
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set('options', `-csearch_path=${schema},public`);
    const config = environmentSchema.parse({
      NODE_ENV: 'test',
      CUTTING_EDGE_TRIM_MM: 1,
      CUTTING_MINIMUM_REMNANT_WIDTH_MM: 100,
      CUTTING_MINIMUM_REMNANT_LENGTH_MM: 100,
      CUTTING_DROP_ALLOWANCE_MM: 0,
      SOLVER_API_KEY: 'integration-solver-key-at-least-32-characters',
      SOLVER_URL: 'http://127.0.0.1:1',
      DATABASE_URL: url.href,
      REDIS_URL: process.env.TEST_REDIS_URL,
      MICROSOFT_TENANT_ID: '11111111-1111-4111-8111-111111111111',
      MICROSOFT_CLIENT_ID: '22222222-2222-4222-8222-222222222222',
      MICROSOFT_CLIENT_SECRET: 'fixture',
      MICROSOFT_CALLBACK_URL: 'http://localhost:3001/api/auth/callback',
      AUTH_ALLOWED_DOMAIN: 'example.com',
      BOOTSTRAP_OWNER_EMAIL: ' Owner@Example.COM ',
      AUTH_SESSION_SECRET: 'integration-test-secret-at-least-32-characters',
      AUTH_SESSION_TTL_SECONDS: 60,
      RATE_LIMIT_API_LIMIT: 10000,
      RATE_LIMIT_LOGIN_LIMIT: 10000,
    });
    let profile = {
      microsoftSubjectId: 'initial-subject',
      name: 'Employee',
      email: ' Employee@Example.COM ',
    };
    let completions = 0;
    let providerFailure: Error | undefined;
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => config],
        }),
        ErrorsModule,
        AuditModule,
        RateLimitingModule,
        AuthModule,
        HealthModule,
        FabricCatalogModule,
        LocationsModule,
        StockItemsModule,
        StockReceiptsModule,
        OrderScheduleModule,
        AllocationsModule,
      ],
    })
      .overrideProvider(RATE_LIMIT_KEY_PREFIX)
      .useValue(rateLimitPrefix)
      .overrideProvider(MicrosoftService)
      .useValue({
        begin: async () => {
          const transaction = {
            state: randomUUID().replaceAll('-', ''),
            nonce: randomUUID(),
            verifier: randomUUID(),
          };
          return {
            transaction,
            url: `https://login.microsoftonline.com/test?state=${transaction.state}`,
          };
        },
        complete: async () => {
          completions++;
          if (providerFailure) throw providerFailure;
          return profile;
        },
      })
      .compile();
    const app = module.createNestApplication<NestExpressApplication>(
      new PassthroughExpressAdapter(),
      { logger: false },
    );
    app.setGlobalPrefix('/api');
    app.enableCors({ origin: config.WEB_ORIGIN, credentials: true });
    const keys = new Set<string>();
    const redis = app.get(RedisService);

    function cookieFrom(response: { headers: Record<string, unknown> }) {
      const headers = response.headers['set-cookie'] as string[];
      assert.ok(headers?.[0]);
      return headers[0].split(';')[0]!;
    }
    function sid(cookie: string) {
      const signed = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1));
      return signed.slice(2, signed.lastIndexOf('.'));
    }
    function remember(cookie: string) {
      keys.add(SESSION_PREFIX + sid(cookie));
      return cookie;
    }
    async function start() {
      const response = await request(app.getHttpServer())
        .get('/api/auth/login')
        .expect(302);
      const cookie = remember(cookieFrom(response));
      const state = new URL(response.headers.location!).searchParams.get(
        'state',
      )!;
      keys.add(
        `roller-bay:oauth:${createHash('sha256').update(sid(cookie)).digest('hex')}:${state}`,
      );
      return { cookie, state };
    }
    function callback(login: { cookie: string; state: string }) {
      return request(app.getHttpServer())
        .get(`/api/auth/callback?code=fixture&state=${login.state}`)
        .set('Cookie', login.cookie);
    }
    function rejectedCallback(
      login: { cookie: string; state: string },
      code: LoginErrorCode = 'sign_in_failed',
    ) {
      return callback(login)
        .expect(302)
        .expect('Location', `${config.WEB_ORIGIN}/login?error=${code}`);
    }
    async function signIn() {
      const login = await start();
      const response = await callback(login).expect(302);
      return {
        ...login,
        authenticated: remember(cookieFrom(response)),
        response,
      };
    }

    try {
      await copyApplicationTables(pool, schema);
      // Keep one listener for the suite; Supertest must not close it between requests.
      await app.listen(0, '127.0.0.1');

      await t.test(
        'liveness stays public, profiles require auth, and untrusted origins are rejected',
        async () => {
          await request(app.getHttpServer()).get('/api/health').expect(200);
          await request(app.getHttpServer()).get('/api/auth/me').expect(401);
          await request(app.getHttpServer())
            .post('/api/auth/logout')
            .expect(403);
          await request(app.getHttpServer())
            .post('/api/auth/logout')
            .set('Origin', 'http://attacker.example')
            .expect(403);
        },
      );

      let authenticated = '';
      let userId = '';
      await t.test(
        'login rotates the ID, normalizes email, strips private fields, and gives a fixed cookie/Redis expiry',
        async () => {
          const login = await signIn();
          authenticated = login.authenticated;
          assert.notEqual(sid(login.cookie), sid(authenticated));
          assert.equal(
            await redis.client.get(SESSION_PREFIX + sid(login.cookie)),
            null,
          );
          assert.equal(login.response.headers.location, config.WEB_ORIGIN);
          assert.match(login.response.headers['set-cookie']![0]!, /HttpOnly/);
          assert.match(
            login.response.headers['set-cookie']![0]!,
            /SameSite=Lax/,
          );
          assert.doesNotMatch(
            login.response.headers['set-cookie']![0]!,
            /Domain=/,
          );
          const me = await request(app.getHttpServer())
            .get('/api/auth/me')
            .set('Cookie', authenticated)
            .expect(200);
          const user = currentUserSchema.parse(me.body);
          userId = user.id;
          assert.equal(user.email, 'employee@example.com');
          assert.equal(user.role, 'user');
          assert.equal(user.isActive, true);
          assert.equal(me.body.microsoftSubjectId, undefined);
          assert.equal(me.headers['cache-control'], 'no-store');
          assert.equal(me.headers['access-control-allow-credentials'], 'true');
          const ttl = await redis.client.ttl(
            SESSION_PREFIX + sid(authenticated),
          );
          assert.ok(ttl > 0 && ttl <= 60);
        },
      );

      await testCatalog(
        t,
        app,
        pool,
        schema,
        authenticated,
        userId,
        config.WEB_ORIGIN,
      );

      await testLocations(
        t,
        app,
        pool,
        schema,
        authenticated,
        userId,
        config.WEB_ORIGIN,
      );

      await testStockItems(
        t,
        app,
        pool,
        schema,
        authenticated,
        userId,
        config.WEB_ORIGIN,
      );

      await testStockReceipts(
        t,
        app,
        pool,
        schema,
        authenticated,
        userId,
        config.WEB_ORIGIN,
      );

      await testOrderSchedule(
        t,
        app,
        pool,
        schema,
        authenticated,
        userId,
        config.WEB_ORIGIN,
      );

      await testAllocations(
        t,
        app,
        pool,
        schema,
        authenticated,
        userId,
        config.WEB_ORIGIN,
      );

      await testCorrections(
        t,
        app,
        pool,
        schema,
        authenticated,
        userId,
        config.WEB_ORIGIN,
      );

      await t.test(
        'login startup failures return to the frontend, and malformed callbacks never reach Microsoft',
        async (t) => {
          const begin = t.mock.method(
            app.get(MicrosoftService),
            'begin',
            async () => {
              throw new ServiceUnavailableException(
                'Provider discovery failed.',
              );
            },
          );
          try {
            await request(app.getHttpServer())
              .get('/api/auth/login')
              .expect(302)
              .expect(
                'Location',
                `${config.WEB_ORIGIN}/login?error=unavailable`,
              );
          } finally {
            begin.mock.restore();
          }
          const before = completions;
          for (const query of [
            'code=private',
            'code=private&state=one&state=two',
          ])
            await request(app.getHttpServer())
              .get(`/api/auth/callback?${query}`)
              .expect(302)
              .expect(
                'Location',
                `${config.WEB_ORIGIN}/login?error=sign_in_failed`,
              );
          assert.equal(completions, before);
        },
      );

      await t.test(
        'an ineligible Microsoft account returns to the login screen without authenticating',
        async () => {
          const login = await start();
          providerFailure = new MicrosoftAccountNotEligibleException();
          try {
            await rejectedCallback(login, 'account_not_eligible')
              .expect('Cache-Control', 'no-store')
              .expect('Referrer-Policy', 'no-referrer');
            await request(app.getHttpServer())
              .get('/api/auth/me')
              .set('Cookie', login.cookie)
              .expect(401);
          } finally {
            providerFailure = undefined;
          }
          await rejectedCallback(login);
        },
      );

      await t.test(
        'callback is browser-bound and one-time even under concurrent replay',
        async () => {
          const login = await start();
          const attacker = await start();
          await rejectedCallback({ ...login, cookie: attacker.cookie });
          const before = completions;
          const responses = await Promise.all([
            callback(login),
            callback(login),
          ]);
          assert.deepEqual(
            responses.map((r) => r.status),
            [302, 302],
          );
          assert.deepEqual(responses.map((r) => r.headers.location).sort(), [
            config.WEB_ORIGIN,
            `${config.WEB_ORIGIN}/login?error=sign_in_failed`,
          ]);
          for (const response of responses)
            if (response.headers.location === config.WEB_ORIGIN)
              remember(cookieFrom(response));
          assert.equal(completions, before + 1);
          await rejectedCallback(login);
          const expired = await start();
          const key = [...keys].find((value) =>
            value.endsWith(`:${expired.state}`),
          )!;
          const value = JSON.parse((await redis.client.get(key))!);
          await redis.client.set(
            key,
            JSON.stringify({ ...value, expiresAt: Date.now() - 1 }),
            { expiration: { type: 'EX', value: 10 } },
          );
          await rejectedCallback(expired);

          const expiredBrowser = await start();
          const sessionKey = SESSION_PREFIX + sid(expiredBrowser.cookie);
          const anonymous: SessionData = JSON.parse(
            (await redis.client.get(sessionKey))!,
          );
          anonymous.expiresAt = Date.now() - 1;
          await redis.client.set(sessionKey, JSON.stringify(anonymous), {
            expiration: { type: 'EX', value: 10 },
          });
          // Even if a rounded Redis TTL leaves the key present, browser-session
          // expiry must deny a callback whose transaction is otherwise valid.
          await rejectedCallback(expiredBrowser);
        },
      );

      await t.test(
        'existing identities retain roles and history while emails change; email conflicts never link accounts',
        async () => {
          await pool.query(
            `UPDATE "${schema}".users SET role='admin' WHERE id=$1`,
            [userId],
          );
          const before = await app.get(UsersService).findById(userId);
          profile = {
            ...profile,
            email: ' Changed.Name+ops@Example.COM ',
            name: 'Updated Name',
          };
          const login = await signIn();
          const user = await app.get(UsersService).findById(userId);
          assert.equal(user?.role, 'admin');
          assert.equal(user?.email, 'changed.name+ops@example.com');
          assert.equal(user?.createdAt, before?.createdAt);
          // Existing sessions read the current database role/profile.
          const me = await request(app.getHttpServer())
            .get('/api/auth/me')
            .set('Cookie', authenticated)
            .expect(200);
          assert.equal(me.body.role, 'admin');
          profile = { ...profile, microsoftSubjectId: 'different-subject' };
          const conflict = await start();
          await rejectedCallback(conflict, 'account_conflict');
          assert.equal(
            (await pool.query(`SELECT count(*) FROM "${schema}".users`)).rows[0]
              .count,
            '1',
          );
          await request(app.getHttpServer())
            .get('/api/auth/me')
            .set('Cookie', conflict.cookie)
            .expect(401);
          profile = { ...profile, email: 'different@example.com' };
          await signIn();
          profile = {
            ...profile,
            microsoftSubjectId: 'initial-subject',
            name: 'Must not update',
          };
          await rejectedCallback(await start(), 'account_conflict');
          assert.equal(
            (await app.get(UsersService).findById(userId))?.name,
            'Updated Name',
          );
          await request(app.getHttpServer())
            .post('/api/auth/logout')
            .set('Cookie', login.authenticated)
            .set('Origin', config.WEB_ORIGIN)
            .expect(204);
        },
      );

      await t.test(
        'concurrent first sign-ins create exactly one default-role user',
        async () => {
          const users = app.get(UsersService);
          const input = {
            microsoftSubjectId: randomUUID(),
            name: 'Concurrent',
            email: ' Concurrent@Example.COM ',
          };
          const results = await Promise.all(
            Array.from({ length: 6 }, () =>
              users.synchronizeMicrosoftProfile(input),
            ),
          );
          assert.equal(new Set(results.map((user) => user.id)).size, 1);
          assert.equal(results[0]?.email, 'concurrent@example.com');
          assert.equal(results[0]?.role, 'user');
        },
      );

      await t.test(
        'admins control activation; inactive users cannot finish login or use existing sessions',
        async () => {
          const savedProfile = profile;
          profile = {
            microsoftSubjectId: randomUUID(),
            name: 'Activation test',
            email: 'activation@example.com',
          };
          const targetLogin = await signIn();
          const target = (
            await request(app.getHttpServer())
              .get('/api/auth/me')
              .set('Cookie', targetLogin.authenticated)
              .expect(200)
          ).body;
          assert.equal(target.isActive, true);
          const path = `/api/users/${target.id}/activation`;
          const change = (body: object, cookie = authenticated, route = path) =>
            request(app.getHttpServer())
              .patch(route)
              .set('Cookie', cookie)
              .set('Origin', config.WEB_ORIGIN)
              .send(body);
          await request(app.getHttpServer())
            .patch(path)
            .set('Origin', config.WEB_ORIGIN)
            .send({ isActive: false })
            .expect(401);
          await change({ isActive: false }, targetLogin.authenticated).expect(
            403,
          );
          await pool.query(
            `UPDATE "${schema}".users SET role='admin' WHERE id=$1`,
            [target.id],
          );
          await request(app.getHttpServer())
            .patch(path)
            .set('Cookie', authenticated)
            .send({ isActive: false })
            .expect(403);
          await request(app.getHttpServer())
            .patch(path)
            .set('Cookie', authenticated)
            .set('Origin', 'https://untrusted.example')
            .send({ isActive: false })
            .expect(403);
          for (const body of [
            {},
            { isActive: 'false' },
            { isActive: 0 },
            { isActive: null },
            { isActive: false, role: 'owner' },
          ])
            await change(body).expect(400);
          await change(
            { isActive: false },
            authenticated,
            '/api/users/not-a-uuid/activation',
          ).expect(400);
          await change(
            { isActive: false },
            authenticated,
            `/api/users/${randomUUID()}/activation`,
          ).expect(404);

          const pendingLogin = await start();
          const disabled = (await change({ isActive: false }).expect(200)).body;
          assert.equal(disabled.id, target.id);
          assert.equal(disabled.isActive, false);
          assert.equal(disabled.role, 'admin');
          assert.equal(disabled.microsoftSubjectId, undefined);
          await change({ isActive: false }).expect(200);
          await request(app.getHttpServer())
            .get('/api/auth/me')
            .set('Cookie', targetLogin.authenticated)
            .expect(403);
          await request(app.getHttpServer())
            .get('/api/fabric-catalog/colors')
            .set('Cookie', targetLogin.authenticated)
            .expect(403);
          await change({ isActive: true }, targetLogin.authenticated).expect(
            403,
          );
          await rejectedCallback(pendingLogin, 'account_inactive');
          const rejectedSession = JSON.parse(
            (await redis.client.get(
              SESSION_PREFIX + sid(pendingLogin.cookie),
            ))!,
          );
          assert.equal(rejectedSession.auth, undefined);
          await rejectedCallback(pendingLogin);
          const anotherLogin = await start();
          await rejectedCallback(anotherLogin, 'account_inactive');
          assert.equal(
            (await app.get(UsersService).findById(target.id))?.isActive,
            false,
          );
          await request(app.getHttpServer())
            .get('/api/auth/me')
            .set('Cookie', anotherLogin.cookie)
            .expect(401);

          const enabled = (await change({ isActive: true }).expect(200)).body;
          assert.equal(enabled.isActive, true);
          assert.equal(enabled.createdAt, target.createdAt);
          await change({ isActive: true }).expect(200);
          const newLogin = await signIn();
          const me = await request(app.getHttpServer())
            .get('/api/auth/me')
            .set('Cookie', newLogin.authenticated)
            .expect(200);
          assert.equal(me.body.id, target.id);
          assert.equal(me.body.isActive, true);
          profile = savedProfile;
        },
      );

      const savedOwnershipProfile = profile;
      await testUserRoles(
        t,
        app,
        pool,
        schema,
        authenticated,
        config.WEB_ORIGIN,
        (next) => {
          profile = next;
        },
        signIn,
        async () => {
          await rejectedCallback(await start(), 'account_inactive');
        },
      );
      profile = savedOwnershipProfile;

      await t.test(
        'absolute expiry survives resaves and stale session data is denied',
        async () => {
          const key = SESSION_PREFIX + sid(authenticated);
          const stored: SessionData = JSON.parse(
            (await redis.client.get(key))!,
          );
          stored.auth!.expiresAt = Date.now() + 1200;
          const adapter = app.get(SessionsRepository).store;
          const save = () =>
            new Promise<void>((resolve, reject) => {
              adapter.set(sid(authenticated), stored, (error) =>
                error ? reject(error) : resolve(),
              );
            });
          assert.ok(adapter.touch);
          const touch = () =>
            new Promise<void>((resolve, reject) => {
              adapter.touch!(sid(authenticated), stored, (error?: unknown) =>
                error ? reject(error) : resolve(),
              );
            });
          await save();
          await touch();
          await save();
          assert.ok((await redis.client.ttl(key)) <= 2);
          await delay(1300);
          // Key may remain for a fractional second; the guard must still reject it.
          await request(app.getHttpServer())
            .get('/api/auth/me')
            .set('Cookie', authenticated)
            .expect(401);
          await delay(800);
          assert.equal(await redis.client.get(key), null);
        },
      );

      await t.test(
        'logout deletes the session, clears the cookie, and invalidates replay; outages fail closed',
        async () => {
          profile = {
            microsoftSubjectId: 'logout-only-subject',
            name: 'Session-only employee',
            email: 'session.fixture@example.com',
          };
          const login = await signIn();
          await request(app.getHttpServer())
            .post('/api/auth/logout')
            .set('Cookie', login.authenticated)
            .expect(403);
          const logout = await request(app.getHttpServer())
            .post('/api/auth/logout')
            .set('Cookie', login.authenticated)
            .set('Origin', config.WEB_ORIGIN)
            .expect(204);
          assert.match(
            logout.headers['set-cookie']![0]!,
            /Expires=Thu, 01 Jan 1970/,
          );
          assert.equal(
            await redis.client.get(SESSION_PREFIX + sid(login.authenticated)),
            null,
          );
          await request(app.getHttpServer())
            .get('/api/auth/me')
            .set('Cookie', login.authenticated)
            .expect(401);
          const active = await signIn();
          redis.client.destroy();
          await request(app.getHttpServer())
            .get('/api/auth/me')
            .set('Cookie', active.authenticated)
            .expect(503);
          await request(app.getHttpServer())
            .post('/api/auth/logout')
            .set('Cookie', active.authenticated)
            .set('Origin', config.WEB_ORIGIN)
            .expect(503);
          await request(app.getHttpServer())
            .get('/api/health')
            .set('Cookie', active.authenticated)
            .expect(200);
          await redis.client.connect();
          const activeUser = await request(app.getHttpServer())
            .get('/api/auth/me')
            .set('Cookie', active.authenticated)
            .expect(200);
          await pool.query(`DELETE FROM "${schema}".users WHERE id=$1`, [
            activeUser.body.id,
          ]);
          await request(app.getHttpServer())
            .get('/api/auth/me')
            .set('Cookie', active.authenticated)
            .expect(401);
        },
      );

      await t.test(
        'production cookies require HTTPS and use the host-only prefix',
        () => {
          const production = new SessionsService(
            app.get(SessionsRepository),
            new ConfigService({ ...config, NODE_ENV: 'production' }),
          );
          assert.equal(production.cookieName, '__Host-roller_bay.sid');
          assert.equal(production.cookieOptions.secure, true);
          assert.equal(production.cookieOptions.path, '/');
          assert.equal(production.cookieOptions.domain, undefined);
        },
      );
    } finally {
      if (redis.client.isReady) {
        for await (const batch of redis.client.scanIterator({
          MATCH: `${rateLimitPrefix}*`,
        })) {
          if (batch.length) await redis.client.del(batch);
        }
      }
      if (redis.client.isReady && keys.size) await redis.client.del([...keys]);
      await app.close();
      // Only the randomly named schema created by this test is removed.
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await pool.end();
    }
  },
);
