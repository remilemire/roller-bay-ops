import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { apiErrorSchema } from '@roller-bay/shared/errors';
import request from 'supertest';
import { ErrorsModule } from './errors.module.js';
import { PassthroughExpressAdapter } from './express.adapter.js';
import {
  UNEXPECTED_ERROR_MESSAGE,
  UNREADABLE_REQUEST_MESSAGE,
} from './translate-error.js';

@Controller('probe')
class ProbeController {
  @Post('echo')
  echo() {
    return { ok: true };
  }

  @Get('item/:id')
  item(@Param('id') id: string) {
    return { id };
  }

  @Get('crash')
  crash() {
    throw new Error('connect ECONNREFUSED secret-host:5432');
  }

  @Get('unavailable')
  unavailable() {
    throw new ServiceUnavailableException('Stock storage is unavailable.', {
      cause: new Error('connect ECONNREFUSED secret-host:5432'),
    });
  }

  @Get('invalid')
  invalid() {
    throw new BadRequestException({
      message: 'Validation failed',
      issues: [
        {
          code: 'too_small',
          path: ['widthMm'],
          message: 'Too small',
          minimum: 0,
        },
        {
          code: 'length_capacity',
          path: 'plan.drops.0',
          message: 'Drop exceeds remaining length.',
        },
      ],
    });
  }

  @Get('proxy')
  proxy() {
    throw Object.assign(new Error('upstream secret-host closed'), {
      statusCode: 502,
      status: 502,
      expose: false,
    });
  }
}

test('every failure leaves the API as the shared envelope without internal detail', async () => {
  const module = await Test.createTestingModule({
    imports: [ErrorsModule],
    controllers: [ProbeController],
  }).compile();
  const app = module.createNestApplication<NestExpressApplication>(
    new PassthroughExpressAdapter(),
    { logger: false },
  );
  app.setGlobalPrefix('/api');
  await app.init();
  try {
    const server = app.getHttpServer();
    const malformed = await request(server)
      .post('/api/probe/echo')
      .set('Content-Type', 'application/json')
      .send('{"bad"')
      .expect(400);
    assert.deepEqual(malformed.body, {
      statusCode: 400,
      message: UNREADABLE_REQUEST_MESSAGE,
    });
    const undecodable = await request(server)
      .get('/api/probe/item/%FF')
      .expect(400);
    assert.deepEqual(undecodable.body, {
      statusCode: 400,
      message: UNREADABLE_REQUEST_MESSAGE,
    });
    const oversized = await request(server)
      .post('/api/probe/echo')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ padding: 'x'.repeat(150_000) }))
      .expect(413);
    assert.deepEqual(oversized.body, {
      statusCode: 413,
      message: 'The request is too large.',
    });
    const crash = await request(server).get('/api/probe/crash').expect(500);
    assert.deepEqual(crash.body, {
      statusCode: 500,
      message: UNEXPECTED_ERROR_MESSAGE,
    });
    const unavailable = await request(server)
      .get('/api/probe/unavailable')
      .expect(503);
    assert.deepEqual(unavailable.body, {
      statusCode: 503,
      message: 'Stock storage is unavailable.',
    });
    const invalid = await request(server).get('/api/probe/invalid').expect(400);
    assert.deepEqual(invalid.body, {
      statusCode: 400,
      message: 'Validation failed',
      issues: [
        { code: 'too_small', path: ['widthMm'], message: 'Too small' },
        {
          code: 'length_capacity',
          path: 'plan.drops.0',
          message: 'Drop exceeds remaining length.',
        },
      ],
    });
    const proxy = await request(server).get('/api/probe/proxy').expect(500);
    assert.deepEqual(proxy.body, {
      statusCode: 500,
      message: UNEXPECTED_ERROR_MESSAGE,
    });
    const missing = await request(server).get('/api/nope').expect(404);
    assert.deepEqual(Object.keys(missing.body).sort(), [
      'message',
      'statusCode',
    ]);
    for (const response of [
      malformed,
      undecodable,
      oversized,
      crash,
      unavailable,
      invalid,
      proxy,
      missing,
    ]) {
      assert.ok(apiErrorSchema.safeParse(response.body).success);
      assert.doesNotMatch(
        JSON.stringify(response.body),
        /secret|token|JSON|entity|upstream|decode|%FF/,
      );
    }
  } finally {
    await app.close();
  }
});
