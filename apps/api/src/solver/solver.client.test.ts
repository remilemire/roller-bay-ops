import assert from 'node:assert/strict';
import { test } from 'node:test';
import { solverModelSchema, type SolverModel } from './solver.contracts.js';
import { parseSolverResult } from './solver.response.js';
import { SolverClient } from './solver.client.js';
import { SolverError } from './solver.errors.js';

const model: SolverModel = {
  variables: [{ name: 'x', lowerBound: 0, upperBound: 10 }],
  constraints: [
    { terms: [{ variable: 'x', coefficient: 1 }], operator: '<=', rhs: 5 },
  ],
  objective: {
    direction: 'maximize',
    terms: [{ variable: 'x', coefficient: 2 }],
  },
};

test('model contracts reject ambiguous references, noninteger data, and unsafe arithmetic', () => {
  const cases: SolverModel[] = [
    { ...model, variables: [...model.variables, ...model.variables] },
    { ...model, variables: [{ name: 'x', lowerBound: 4, upperBound: 3 }] },
    { ...model, variables: [{ name: 'x', lowerBound: 0.5, upperBound: 10 }] },
    {
      ...model,
      variables: [
        { name: 'x', lowerBound: 0, upperBound: Number.MAX_SAFE_INTEGER + 1 },
      ],
    },
    {
      ...model,
      objective: {
        direction: 'minimize',
        terms: [{ variable: 'missing', coefficient: 1 }],
      },
    },
    {
      ...model,
      objective: {
        direction: 'minimize',
        terms: [{ variable: 'x', coefficient: Number.MAX_SAFE_INTEGER }],
      },
    },
    {
      ...model,
      constraints: [
        { ...model.constraints[0]!, onlyEnforceIf: [{ variable: 'x' }] },
      ],
    },
    {
      ...model,
      constraints: [
        {
          ...model.constraints[0]!,
          terms: [
            { variable: 'x', coefficient: 1 },
            { variable: 'x', coefficient: 2 },
          ],
        },
      ],
    },
  ];
  for (const invalid of cases)
    assert.equal(solverModelSchema.safeParse(invalid).success, false);
});

test('response validation rejects fabricated assignments and objective values', () => {
  const valid = {
    status: 'optimal',
    values: { x: 5 },
    objectiveValue: 10,
    bestObjectiveBound: 10,
    wallTimeSeconds: 0.01,
  };
  const parsedModel = solverModelSchema.parse(model);
  assert.deepEqual(
    parseSolverResult(JSON.stringify(valid), parsedModel),
    valid,
  );
  for (const response of [
    { ...valid, values: { x: 6 }, objectiveValue: 12 },
    { ...valid, values: { x: 5, y: 0 } },
    { ...valid, values: {} },
    { ...valid, objectiveValue: 9 },
    { ...valid, values: { x: 1.5 } },
    { status: 'unknown', values: { x: 0 }, wallTimeSeconds: 0 },
  ])
    assert.throws(
      () => parseSolverResult(JSON.stringify(response), parsedModel),
      { code: 'protocol_error' },
    );
  assert.throws(() => parseSolverResult('not JSON', parsedModel), {
    code: 'protocol_error',
  });
});

test('invalid models and options fail before attempting to send HTTP', async () => {
  const client = new SolverClient({
    baseUrl: 'http://127.0.0.1:1',
    apiKey: 'test-key-'.repeat(4),
  });
  await assert.rejects(client.solve({ ...model, variables: [] }), {
    code: 'invalid_model',
  });
  await assert.rejects(client.solve(model, { maxTimeSeconds: -1 }), {
    code: 'invalid_options',
  });
  await assert.rejects(
    client.solve(model),
    (error) => error instanceof SolverError && error.code === 'unavailable',
  );
  await client.onModuleDestroy();
  await assert.rejects(client.solve(model), { code: 'closed' });
});

test('HTTP wrapper maps service errors and rejects oversized responses', async (t) => {
  const options = {
    baseUrl: 'http://solver.test',
    apiKey: 'test-key-'.repeat(4),
  };
  for (const [status, code] of [
    [409, 'busy'],
    [422, 'invalid_model'],
    [504, 'timeout'],
    [401, 'unavailable'],
  ] as const) {
    const mock = t.mock.method(
      globalThis,
      'fetch',
      async () => new Response('', { status }),
    );
    const client = new SolverClient(options);
    await assert.rejects(client.solve(model), { code });
    await client.onModuleDestroy();
    mock.mock.restore();
  }
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('x'.repeat(4 * 1024 * 1024 + 1)),
  );
  const client = new SolverClient(options);
  await assert.rejects(client.solve(model), { code: 'protocol_error' });
  await client.onModuleDestroy();
});

test('HTTP wrapper aborts pending requests on shutdown', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async (_url: unknown, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener(
          'abort',
          () => reject(new Error('Aborted')),
          { once: true },
        );
      }),
  );
  const client = new SolverClient({
    baseUrl: 'http://solver.test',
    apiKey: 'test-key-'.repeat(4),
  });
  const rejected = assert.rejects(client.solve(model), { code: 'cancelled' });
  await client.onModuleDestroy();
  await rejected;
});
