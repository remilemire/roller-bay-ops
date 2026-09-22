import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import { ConfigModule } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import {
  currentUserSchema,
  type LoginErrorCode,
} from '@roller-bay/shared/auth';
import { Pool } from 'pg';
import request from 'supertest';
import { ErrorsModule } from '../common/errors/errors.module.js';
import { PassthroughExpressAdapter } from '../common/errors/express.adapter.js';
import { environmentSchema } from '../config/environment.js';
import { createTestDatabase } from '../database/testing/test-database.js';
import { AllocationsModule } from '../features/allocations/allocations.module.js';
import { ProductionModule } from '../features/production/production.module.js';
import { AuditModule } from '../features/audit/audit.module.js';
import { AuthModule } from '../features/auth/auth.module.js';
import { MicrosoftService } from '../features/auth/microsoft.service.js';
import { SESSION_PREFIX } from '../features/auth/sessions/sessions.repository.js';
import { FabricCatalogModule } from '../features/fabric-catalog/fabric-catalog.module.js';
import { HealthModule } from '../features/health/health.module.js';
import { LocationsModule } from '../features/locations/locations.module.js';
import { WorkOrdersModule } from '../features/work-orders/work-orders.module.js';
import { StockItemsModule } from '../features/stock-items/stock-items.module.js';
import { StockReceiptsModule } from '../features/stock-receipts/stock-receipts.module.js';
import type { MicrosoftProfileInput } from '../features/users/microsoft-profile.schema.js';
import { RateLimitingModule } from '../rate-limiting/rate-limiting.module.js';
import { RATE_LIMIT_KEY_PREFIX } from '../rate-limiting/rate-limiting.service.js';
import { RedisService } from '../redis/redis.service.js';
import { createFixtures } from './fixtures.js';
import { testDatabaseUrl, testRedisUrl } from './test-services.js';

/**
 * The whole API over real PostgreSQL and Redis, with Microsoft sign-in
 * replaced by a provider the test controls. Each caller gets its own migrated
 * database, Redis key prefix and listener, all removed when the test ends, so
 * integration files are independent and can run in parallel.
 */
export async function startIntegrationApp(t: TestContext) {
  const rateLimitPrefix = `roller-bay:test:rate-limit:${randomUUID()}:`;
  const database = await createTestDatabase(testDatabaseUrl);
  const keys = new Set<string>();
  // Filled in as they start, so the cleanup below closes whatever exists.
  const started: { app?: NestExpressApplication; pool?: Pool } = {};
  // Registered before anything else can fail, and in the one order that
  // works: the database can only be dropped once its connections are closed.
  t.after(async () => {
    const redis = started.app?.get(RedisService);
    if (redis?.client.isReady) {
      for await (const batch of redis.client.scanIterator({
        MATCH: `${rateLimitPrefix}*`,
      })) {
        if (batch.length) await redis.client.del(batch);
      }
      if (keys.size) await redis.client.del([...keys]);
    }
    await started.app?.close();
    await started.pool?.end();
    await database.drop();
  });
  const pool = new Pool({ connectionString: database.url });
  started.pool = pool;
  const config = environmentSchema.parse({
    NODE_ENV: 'test',
    CUTTING_EDGE_TRIM_MM: 1,
    CUTTING_MINIMUM_REMNANT_WIDTH_MM: 100,
    CUTTING_MINIMUM_REMNANT_LENGTH_MM: 100,
    CUTTING_DROP_ALLOWANCE_MM: 0,
    SOLVER_API_KEY: 'integration-solver-key-at-least-32-characters',
    SOLVER_URL: 'http://127.0.0.1:1',
    DATABASE_URL: database.url,
    REDIS_URL: testRedisUrl,
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
  // What the stand-in for Microsoft returns; tests change it to sign in as
  // someone else or to make the provider fail.
  const provider: {
    profile: MicrosoftProfileInput;
    failure: Error | undefined;
    completions: number;
  } = {
    profile: {
      microsoftSubjectId: 'initial-subject',
      name: 'Employee',
      email: ' Employee@Example.COM ',
    },
    failure: undefined,
    completions: 0,
  };
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: [() => config],
      }),
      ErrorsModule,
      AuditModule,
      ProductionModule,
      RateLimitingModule,
      AuthModule,
      HealthModule,
      FabricCatalogModule,
      LocationsModule,
      StockItemsModule,
      StockReceiptsModule,
      WorkOrdersModule,
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
        provider.completions++;
        if (provider.failure) throw provider.failure;
        return provider.profile;
      },
    })
    .compile();
  const app = module.createNestApplication<NestExpressApplication>(
    new PassthroughExpressAdapter(),
    { logger: false },
  );
  started.app = app;
  app.setGlobalPrefix('/api');
  app.enableCors({ origin: config.WEB_ORIGIN, credentials: true });
  // Keep one listener for the file; Supertest must not close it between requests.
  await app.listen(0, '127.0.0.1');
  const server = app.getHttpServer();

  function cookieFrom(response: { headers: Record<string, unknown> }) {
    const headers = response.headers['set-cookie'] as string[];
    assert.ok(headers?.[0]);
    return headers[0].split(';')[0]!;
  }
  function sid(cookie: string) {
    const signed = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1));
    return signed.slice(2, signed.lastIndexOf('.'));
  }
  /** Marks a session's Redis key for removal when the test ends. */
  function remember(cookie: string) {
    keys.add(SESSION_PREFIX + sid(cookie));
    return cookie;
  }
  /** Where Redis holds a started login's one-time transaction. */
  function oauthKey(login: { cookie: string; state: string }) {
    return `roller-bay:oauth:${createHash('sha256').update(sid(login.cookie)).digest('hex')}:${login.state}`;
  }
  async function start() {
    const response = await request(server).get('/api/auth/login').expect(302);
    const cookie = remember(cookieFrom(response));
    const state = new URL(response.headers.location!).searchParams.get(
      'state',
    )!;
    keys.add(oauthKey({ cookie, state }));
    return { cookie, state };
  }
  function callback(login: { cookie: string; state: string }) {
    return request(server)
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
  return {
    app,
    pool,
    fixtures: createFixtures(pool),
    config,
    origin: config.WEB_ORIGIN,
    redis: app.get(RedisService),
    provider,
    cookieFrom,
    sid,
    remember,
    oauthKey,
    start,
    callback,
    rejectedCallback,
    signIn,
  };
}

/** The app with one employee already signed in, which most features need. */
export async function startSignedInApp(t: TestContext) {
  const harness = await startIntegrationApp(t);
  const { authenticated: cookie } = await harness.signIn();
  const me = await request(harness.app.getHttpServer())
    .get('/api/auth/me')
    .set('Cookie', cookie)
    .expect(200);
  return { ...harness, cookie, userId: currentUserSchema.parse(me.body).id };
}
