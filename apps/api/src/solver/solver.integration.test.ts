import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SolverClient } from './solver.client.js';
import type { SolverModel } from './solver.contracts.js';

const simple: SolverModel = {
  variables: [{ name: 'x', lowerBound: 0, upperBound: 10 }],
  constraints: [],
  objective: {
    direction: 'maximize',
    terms: [{ variable: 'x', coefficient: 1 }],
  },
};

test(
  'Solver client against the standalone HTTP service',
  { skip: process.env.SOLVER_INTEGRATION_TESTS !== '1' },
  async (t) => {
    const options = {
      baseUrl: process.env.SOLVER_URL ?? 'http://127.0.0.1:8001',
      apiKey: process.env.SOLVER_API_KEY ?? '',
    };
    const client = new SolverClient(options);
    t.after(() => client.onModuleDestroy());
    await t.test(
      'solves maximum, minimum, and feasibility requests',
      async () => {
        const maximum = await client.solve(simple);
        assert.equal(maximum.status, 'optimal');
        if (maximum.status !== 'optimal') throw new Error('No solution');
        assert.equal(maximum.values.x, 10);
        const minimum = await client.solve({
          ...simple,
          objective: { ...simple.objective!, direction: 'minimize' },
        });
        assert.equal(minimum.status, 'optimal');
        if (minimum.status === 'optimal') assert.equal(minimum.values.x, 0);
        const feasible = await client.solve({
          variables: simple.variables,
          constraints: [],
        });
        assert.equal(feasible.status, 'optimal');
        if (feasible.status === 'optimal')
          assert.equal(feasible.objectiveValue, null);
      },
    );
    await t.test(
      'handles Boolean enforcement and negative coefficients',
      async () => {
        const result = await client.solve({
          variables: [
            ...simple.variables,
            { name: 'b', lowerBound: 0, upperBound: 1 },
          ],
          constraints: [
            {
              terms: [{ variable: 'b', coefficient: 1 }],
              operator: '==',
              rhs: 0,
            },
            {
              terms: [{ variable: 'x', coefficient: -1 }],
              operator: '>=',
              rhs: -3,
              onlyEnforceIf: [{ variable: 'b', negated: true }],
            },
          ],
          objective: simple.objective,
        });
        assert.equal(result.status, 'optimal');
        if (result.status === 'optimal') assert.equal(result.values.x, 3);
      },
    );
    await t.test(
      'distinguishes infeasibility from search timeout',
      async () => {
        const impossible = await client.solve({
          ...simple,
          constraints: [
            {
              terms: [{ variable: 'x', coefficient: 1 }],
              operator: '>=',
              rhs: 11,
            },
          ],
        });
        assert.equal(impossible.status, 'infeasible');
        assert.equal(
          (await client.solve(simple, { maxTimeSeconds: 1e-9 })).status,
          'unknown',
        );
      },
    );
    await t.test('rejects incorrect service credentials', async () => {
      const unauthorized = new SolverClient({
        ...options,
        apiKey: 'wrong-key-'.repeat(4),
      });
      await assert.rejects(unauthorized.solve(simple), { code: 'unavailable' });
      await unauthorized.onModuleDestroy();
    });
    await t.test(
      'honors pre-cancellation and shutdown without starting another request',
      async () => {
        await assert.rejects(
          client.solve(simple, { signal: AbortSignal.abort() }),
          { code: 'cancelled' },
        );
        const closed = new SolverClient(options);
        await closed.onModuleDestroy();
        await assert.rejects(closed.solve(simple), { code: 'closed' });
      },
    );
  },
);
