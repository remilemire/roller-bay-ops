import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { apiErrorSchema } from '@roller-bay/shared/errors';
import {
  translateError,
  UNEXPECTED_ERROR_MESSAGE,
  UNREADABLE_REQUEST_MESSAGE,
} from './translate-error.js';

test('curated HttpExceptions pass through as the shared envelope and nothing more', () => {
  assert.deepEqual(
    translateError(new NotFoundException('Stock item not found.')),
    {
      status: 404,
      body: { statusCode: 404, message: 'Stock item not found.' },
    },
  );
  assert.deepEqual(translateError(new HttpException('Teapot.', 418)).body, {
    statusCode: 418,
    message: 'Teapot.',
  });
  assert.deepEqual(
    translateError(
      new ServiceUnavailableException('Stock storage is unavailable.', {
        cause: new Error('connect ECONNREFUSED 127.0.0.1:5432'),
      }),
    ).body,
    { statusCode: 503, message: 'Stock storage is unavailable.' },
  );
});

test('field issues survive in both shapes the API emits; extra keys and malformed lists are dropped', () => {
  const translated = translateError(
    new ConflictException({
      message: 'Stock availability changed or is insufficient.',
      issues: [
        {
          code: 'too_small',
          path: ['items', 0, 'widthMm'],
          message: 'Too small: expected number to be >0',
          minimum: 0,
          origin: 'number',
          input: -1,
        },
        {
          code: 'length_capacity',
          path: 'plan.drops.0',
          message: 'Drop exceeds remaining length.',
        },
      ],
    }),
  );
  assert.deepEqual(translated.body, {
    statusCode: 409,
    message: 'Stock availability changed or is insufficient.',
    issues: [
      {
        code: 'too_small',
        path: ['items', 0, 'widthMm'],
        message: 'Too small: expected number to be >0',
      },
      {
        code: 'length_capacity',
        path: 'plan.drops.0',
        message: 'Drop exceeds remaining length.',
      },
    ],
  });
  assert.ok(apiErrorSchema.safeParse(translated.body).success);
  for (const issues of [
    'nope',
    [],
    [{ message: '' }],
    [{ path: { deep: true }, message: 'x' }],
  ])
    assert.deepEqual(
      translateError(
        new BadRequestException({ message: 'Validation failed', issues }),
      ).body,
      { statusCode: 400, message: 'Validation failed' },
    );
});

test('an HttpException without a usable message falls back to generic copy', () => {
  assert.equal(
    translateError(new BadRequestException({ message: ['a', 'b'] })).body
      .message,
    'The request could not be completed.',
  );
  assert.equal(
    translateError(new BadRequestException({ issues: [] })).body.message,
    'The request could not be completed.',
  );
  assert.equal(
    translateError(new HttpException({ message: '' }, 500)).body.message,
    UNEXPECTED_ERROR_MESSAGE,
  );
});

test('Express request errors report a curated status and never the parser text', () => {
  // body-parser decorates its SyntaxError through http-errors.
  const parse = Object.assign(
    new SyntaxError('Unexpected token \'x\', "{"a": x}" is not valid JSON'),
    {
      statusCode: 400,
      status: 400,
      expose: true,
      type: 'entity.parse.failed',
      body: '{"a": x}',
    },
  );
  const translated = translateError(parse);
  assert.deepEqual(translated, {
    status: 400,
    body: { statusCode: 400, message: UNREADABLE_REQUEST_MESSAGE },
  });
  assert.doesNotMatch(JSON.stringify(translated.body), /token|JSON|"a"/);
  // Express's path decoder sets `status` only.
  assert.deepEqual(
    translateError(
      Object.assign(new URIError("Failed to decode param '%FF'"), {
        status: 400,
      }),
    ),
    {
      status: 400,
      body: { statusCode: 400, message: UNREADABLE_REQUEST_MESSAGE },
    },
  );
  assert.equal(
    translateError({
      statusCode: 413,
      message: 'request entity too large',
      length: 200001,
      limit: 102400,
    }).body.message,
    'The request is too large.',
  );
  assert.equal(
    translateError({ statusCode: 415, message: 'unsupported charset "X"' }).body
      .message,
    'The request format is not supported.',
  );
  assert.equal(
    translateError({ statusCode: 403, message: 'entity verify failed' }).body
      .message,
    'The request could not be completed.',
  );
  assert.deepEqual(
    translateError({ statusCode: 502, message: 'upstream closed secret-host' }),
    {
      status: 500,
      body: { statusCode: 500, message: UNEXPECTED_ERROR_MESSAGE },
    },
  );
});

test('everything else is an unexpected server fault with generic copy', () => {
  for (const failure of [
    new Error('password authentication failed for user "roller"', {
      cause: new Error('connect ECONNREFUSED 127.0.0.1:5432'),
    }),
    Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      constraint: 'users_email_unique',
    }),
    new URIError('URI malformed'),
    { statusCode: 'four hundred', message: 'not an http error' },
    'string failure',
    undefined,
  ])
    assert.deepEqual(translateError(failure), {
      status: 500,
      body: { statusCode: 500, message: UNEXPECTED_ERROR_MESSAGE },
    });
});
