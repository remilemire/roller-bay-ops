import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { Controller, Get, Post } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  FRONTEND_PROXY_CLIENT_IP_HEADER,
  FRONTEND_PROXY_SECRET_HEADER,
} from '@roller-bay/shared/frontend-proxy';
import request from 'supertest';
import { ErrorsModule } from '../common/errors/errors.module.js';
import { testRedisUrl } from '../testing/test-services.js';
import { PassthroughExpressAdapter } from '../common/errors/express.adapter.js';
import { FrontendProxyModule } from '../frontend-proxy/frontend-proxy.module.js';
import { RedisService } from '../redis/redis.service.js';
import { RateLimitingModule } from './rate-limiting.module.js';
import { RATE_LIMIT_KEY_PREFIX } from './rate-limiting.service.js';

@Controller()
class ProbeController {
  @Get(['health', 'items', 'other', 'auth/login', 'auth/callback'])
  read() {
    return { ok: true };
  }

  @Post('items')
  write() {
    return { ok: true };
  }
}

test(
  'rate limiting uses shared Redis counters before route handlers',
  {
    skip: process.env.AUTH_INTEGRATION_TESTS !== '1',
    timeout: 15000,
  },
  async (t) => {
    const prefix = `roller-bay:test:rate-limit:${randomUUID()}:`;
    const proxySecret = 'proxy-secret-that-is-at-least-32-characters';
    async function createApp(extra: Record<string, unknown> = {}) {
      const module = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            ignoreEnvFile: true,
            load: [
              () => ({
                REDIS_URL: testRedisUrl,
                RATE_LIMIT_WINDOW_SECONDS: 60,
                RATE_LIMIT_API_LIMIT: 6,
                RATE_LIMIT_LOGIN_LIMIT: 2,
                ...extra,
              }),
            ],
          }),
          ErrorsModule,
          // Same relative order as AppModule.
          FrontendProxyModule,
          RateLimitingModule,
        ],
        controllers: [ProbeController],
      })
        .overrideProvider(RATE_LIMIT_KEY_PREFIX)
        .useValue(prefix)
        .compile();
      const app = module.createNestApplication<NestExpressApplication>(
        new PassthroughExpressAdapter(),
        { logger: false },
      );
      app.setGlobalPrefix('/api');
      // Same explicit-proxy configuration used by main.ts; no proxies trusted.
      app.set('trust proxy', []);
      // Parallel requests share a listener instead of starting/stopping it themselves.
      await app.listen(0, '127.0.0.1');
      return app;
    }
    const first = await createApp();
    const second = await createApp();
    const proxied = await createApp({ API_PROXY_SECRET: proxySecret });
    const redis = first.get(RedisService);
    async function clearCounters() {
      for await (const keys of redis.client.scanIterator({
        MATCH: `${prefix}*`,
      })) {
        if (keys.length) await redis.client.del(keys);
      }
    }
    try {
      await t.test(
        'login and callback share a stricter budget across API instances',
        async () => {
          await request(first.getHttpServer())
            .get('/api/auth/login')
            .expect(200);
          await request(second.getHttpServer())
            .get('/api/auth/callback')
            .expect(200);
          const blocked = await request(first.getHttpServer())
            .get('/api/auth/login?next=other')
            .expect(429);
          assert.equal(blocked.body.statusCode, 429);
          assert.ok(Number(blocked.headers['retry-after']) > 0);
          assert.match(blocked.headers.ratelimit!, /login/);
          await request(second.getHttpServer()).get('/api/items').expect(200);
          await clearCounters();
        },
      );

      await t.test(
        'the API budget spans paths and methods and is atomic under concurrency',
        async () => {
          const responses = await Promise.all(
            Array.from({ length: 12 }, (_, index) => {
              const server = (index % 2 ? first : second).getHttpServer();
              return index % 3
                ? request(server).get('/api/other')
                : request(server).post('/api/items');
            }),
          );
          assert.equal(
            responses.filter((response) => response.status === 429).length,
            6,
          );
          assert.equal(
            responses.filter((response) => response.status < 300).length,
            6,
          );
          await request(first.getHttpServer())
            .get('/api/items')
            .set('X-Forwarded-For', '198.51.100.1')
            .expect(429);
          await clearCounters();
        },
      );

      await t.test(
        'health and preflight do not spend budget; counters expire without extending on denial',
        async () => {
          for (let index = 0; index < 8; index++) {
            await request(first.getHttpServer()).get('/api/health').expect(200);
            await request(first.getHttpServer()).options('/api/items');
          }
          await request(first.getHttpServer())
            .get('/api/auth/login')
            .expect(200);
          await request(first.getHttpServer())
            .get('/api/auth/callback')
            .expect(200);
          const keys = await redis.client.keys(`${prefix}login:*`);
          assert.equal(keys.length, 1);
          // Shorten only this test's real key; expiry and recovery still run in Redis.
          await redis.client.pExpire(keys[0]!, 250);
          await request(first.getHttpServer())
            .get('/api/auth/login')
            .expect(429);
          assert.ok((await redis.client.pTTL(keys[0]!)) <= 250);
          await delay(300);
          await request(first.getHttpServer())
            .get('/api/auth/login')
            .expect(200);
          await clearCounters();
        },
      );

      await t.test(
        'trusted proxy addresses distinguish clients; IPv6 addresses share a subnet budget',
        async () => {
          first.set('trust proxy', ['loopback']);
          for (const ip of ['198.51.100.2', '198.51.100.3']) {
            for (let index = 0; index < 2; index++) {
              await request(first.getHttpServer())
                .get('/api/auth/login')
                .set('X-Forwarded-For', ip)
                .expect(200);
            }
          }
          await request(first.getHttpServer())
            .get('/api/auth/login')
            .set('X-Forwarded-For', '198.51.100.2')
            .expect(429);
          for (const ip of ['2001:db8:abcd:1200::1', '2001:db8:abcd:12ff::2']) {
            await request(first.getHttpServer())
              .get('/api/auth/login')
              .set('X-Forwarded-For', ip)
              .expect(200);
          }
          await request(first.getHttpServer())
            .get('/api/auth/login')
            .set('X-Forwarded-For', '2001:db8:abcd:12aa::3')
            .expect(429);
          first.set('trust proxy', []);
          await clearCounters();
        },
      );

      await t.test(
        'an authenticated frontend proxy reports the client address; IPv6 addresses share a subnet budget',
        async () => {
          const login = (ip: string) =>
            request(proxied.getHttpServer())
              .get('/api/auth/login')
              .set(FRONTEND_PROXY_SECRET_HEADER, proxySecret)
              .set(FRONTEND_PROXY_CLIENT_IP_HEADER, ip)
              // Still untrusted, and must not override the reported address.
              .set('X-Forwarded-For', '203.0.113.9');
          for (const ip of ['198.51.100.4', '198.51.100.5']) {
            await login(ip).expect(200);
            await login(ip).expect(200);
          }
          await login('198.51.100.4').expect(429);
          await login('2001:db8:abcd:3400::1').expect(200);
          await login('2001:db8:abcd:34ff::2').expect(200);
          await login('2001:db8:abcd:34aa::3').expect(429);
          await clearCounters();
        },
      );

      await t.test(
        'requests that bypass the frontend proxy are rejected before spending budget',
        async () => {
          for (const presented of [undefined, `${proxySecret}x`]) {
            const direct = request(proxied.getHttpServer())
              .get('/api/auth/login')
              .set(FRONTEND_PROXY_CLIENT_IP_HEADER, '198.51.100.6');
            if (presented) direct.set(FRONTEND_PROXY_SECRET_HEADER, presented);
            const response = await direct.expect(403);
            assert.equal(response.body.statusCode, 403);
            assert.equal(response.headers.ratelimit, undefined);
          }
          assert.deepEqual(await redis.client.keys(`${prefix}*`), []);
          // The host's probes call the service directly.
          await request(proxied.getHttpServer()).get('/api/health').expect(200);
        },
      );

      await t.test(
        'without a configured secret a reported client address is ignored',
        async () => {
          for (const ip of ['198.51.100.7', '198.51.100.8'])
            await request(first.getHttpServer())
              .get('/api/auth/login')
              .set(FRONTEND_PROXY_SECRET_HEADER, proxySecret)
              .set(FRONTEND_PROXY_CLIENT_IP_HEADER, ip)
              .expect(200);
          await request(first.getHttpServer())
            .get('/api/auth/login')
            .set(FRONTEND_PROXY_CLIENT_IP_HEADER, '198.51.100.9')
            .expect(429);
          await clearCounters();
        },
      );

      await t.test(
        'Redis failures deny traffic with 503 and recover without a memory fallback',
        async () => {
          redis.client.destroy();
          const response = await request(first.getHttpServer())
            .get('/api/auth/login')
            .expect(503);
          assert.equal(response.body.message, 'Rate limiting is unavailable.');
          await request(first.getHttpServer()).get('/api/health').expect(200);
          await redis.client.connect();
          await request(first.getHttpServer())
            .get('/api/auth/login')
            .expect(200);
        },
      );
    } finally {
      if (redis.client.isReady) await clearCounters();
      await Promise.all([first.close(), second.close(), proxied.close()]);
    }
  },
);
