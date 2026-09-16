import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SolverClient } from '../../../solver/solver.client.js';
import { SolverError } from '../../../solver/solver.errors.js';
import type {
  SolverModel,
  SolveOptions,
  SolveResult,
} from '../../../solver/solver.contracts.js';
import { solverModelSchema } from '../../../solver/solver.contracts.js';
import { CuttingPlanOptimizer } from './cutting-plan-optimizer.js';
import { generatePatterns } from './pattern-generation.js';
import { buildCuttingModel, modelFitsTransport } from './cutting-model.js';
import { parseOptimizationContext } from './optimization.input.js';
import { fixture, id } from './optimizer.fixtures.js';

function client() {
  return new SolverClient({
    baseUrl: 'http://solver.test',
    apiKey: 'test-key-'.repeat(4),
  });
}

// Independent exhaustive integer-model solver for small orchestration fixtures only.
function solveTinyModel(model: SolverModel): SolveResult {
  const values: Record<string, number> = {};
  let best: Record<string, number> | undefined;
  let objective = Infinity;
  const rules = () =>
    model.constraints.every((rule) => {
      if (
        (rule.onlyEnforceIf ?? []).some(
          (literal) => values[literal.variable] !== (literal.negated ? 0 : 1),
        )
      )
        return true;
      if (rule.terms.some((term) => values[term.variable] === undefined))
        return true;
      const lhs = rule.terms.reduce(
        (sum, term) => sum + term.coefficient * values[term.variable]!,
        0,
      );
      return rule.operator === '=='
        ? lhs === rule.rhs
        : rule.operator === '<='
          ? lhs <= rule.rhs
          : lhs >= rule.rhs;
    });
  function visit(index: number): void {
    if (!rules()) return;
    const variable = model.variables[index];
    if (!variable) {
      const cost = (model.objective?.terms ?? []).reduce(
        (sum, term) => sum + term.coefficient * values[term.variable]!,
        0,
      );
      if (cost < objective) {
        best = { ...values };
        objective = cost;
      }
      return;
    }
    assert.ok(
      variable.upperBound <= 100,
      'Tiny solver fixture has an excessive domain',
    );
    for (
      let value = variable.lowerBound;
      value <= variable.upperBound;
      value++
    ) {
      values[variable.name] = value;
      visit(index + 1);
    }
    delete values[variable.name];
  }
  visit(0);
  return best
    ? {
        status: 'optimal',
        values: best,
        objectiveValue: objective,
        bestObjectiveBound: objective,
        wallTimeSeconds: 0.1,
      }
    : { status: 'infeasible', wallTimeSeconds: 0.1 };
}

test('rejects invalid inputs/options and cancellation before contacting the solver', async (t) => {
  const solver = client();
  const spy = t.mock.method(solver, 'solve', async () => {
    throw new Error('Must not solve');
  });
  const optimizer = new CuttingPlanOptimizer(solver);
  const context = fixture();
  await assert.rejects(optimizer.optimize(context, { maxTimeSeconds: 61 }), {
    code: 'invalid_options',
  });
  await assert.rejects(
    optimizer.optimize(context, { signal: AbortSignal.abort() }),
    { code: 'cancelled' },
  );
  for (const change of [
    (c: ReturnType<typeof fixture>) => {
      c.requirements[0]!.quantity = 101;
    },
    (c: ReturnType<typeof fixture>) => {
      c.requirements.push({ ...c.requirements[0]! });
    },
    (c: ReturnType<typeof fixture>) => {
      c.stockItems.push({ ...c.stockItems[0]! });
    },
    (c: ReturnType<typeof fixture>) => {
      c.stockItems[0]!.reservedLengthMm = 10;
    },
    (c: ReturnType<typeof fixture>) => {
      c.requirements[0]!.widthMm = 0.0001;
    },
  ]) {
    const invalid = fixture();
    change(invalid);
    await assert.rejects(optimizer.optimize(invalid), {
      code: 'invalid_input',
    });
  }
  assert.equal(spy.mock.callCount(), 0);
});

test('only necessary feasibility failures bypass solving; orientation, trims, consumption and reservations matter', async (t) => {
  const solver = client();
  const spy = t.mock.method(solver, 'solve', async () => {
    throw new Error('Must not solve');
  });
  for (const change of [
    (c: ReturnType<typeof fixture>) => {
      c.stockItems = [];
    },
    (c: ReturnType<typeof fixture>) => {
      c.requirements[0]!.widthMm = 9;
    },
    (c: ReturnType<typeof fixture>) => {
      c.stockItems[0]!.remainingLengthMm = 2;
    },
    (c: ReturnType<typeof fixture>) => {
      c.stockItems[0]!.consumedAt = '2026-09-16T00:00:00Z';
    },
    (c: ReturnType<typeof fixture>) => {
      c.stockItems[0]!.isRemnant = true;
      c.stockItems[0]!.reservedLengthMm = 1;
    },
    (c: ReturnType<typeof fixture>) => {
      c.stockItems[0]!.reservedLengthMm = 7;
    },
  ]) {
    const context = fixture();
    change(context);
    assert.deepEqual(await new CuttingPlanOptimizer(solver).optimize(context), {
      status: 'infeasible',
    });
  }
  assert.equal(spy.mock.callCount(), 0);
});

test('candidate budgets are fair across colors, truncation is explicit, and generation is deterministic', async () => {
  const context = fixture();
  context.requirements.push({
    ...context.requirements[0]!,
    id: id(2),
    fabricColorId: id(11),
  });
  context.stockItems.push({
    ...context.stockItems[0]!,
    id: id(21),
    fabricColorId: id(11),
  });
  const limits = { patterns: 2, nodes: 100, assignments: 2 };
  const candidates = await generatePatterns(context, undefined, limits);
  assert.equal(candidates.complete, false);
  assert.equal(candidates.assignments.length, 2);
  assert.deepEqual(
    new Set(candidates.assignments.map((item) => item.pattern.colorId)),
    new Set([id(10), id(11)]),
  );
  assert.deepEqual(
    await generatePatterns(context, undefined, limits),
    candidates,
  );
  const full = await generatePatterns(fixture());
  assert.equal(full.complete, true);
  assert.deepEqual(
    full.assignments.map((item) => item.pattern.items[0]!.quantity).sort(),
    [1, 2],
  );
  const assignmentLimited = await generatePatterns(fixture(), undefined, {
    patterns: 100,
    nodes: 10000,
    assignments: 1,
  });
  assert.equal(assignmentLimited.complete, false);
  assert.equal(assignmentLimited.assignments.length, 1);
});

test('generation yields to cancellation and does not mutate its input', async () => {
  const context = fixture();
  context.requirements = Array.from({ length: 20 }, (_, i) => ({
    ...context.requirements[0]!,
    id: id(i + 1),
    widthMm: 1,
    quantity: 1,
  }));
  context.stockItems[0]!.widthMm = 100;
  const before = structuredClone(context);
  const abort = new AbortController();
  const pending = generatePatterns(context, abort.signal);
  setImmediate(() => abort.abort());
  await assert.rejects(pending, { code: 'cancelled' });
  assert.deepEqual(context, before);
});

test('successive passes lock proven values and share the search budget', async (t) => {
  const solver = client();
  const models: SolverModel[] = [];
  const budgets: number[] = [];
  t.mock.method(
    solver,
    'solve',
    async (model: SolverModel, options?: SolveOptions) => {
      models.push(structuredClone(model));
      budgets.push(options?.maxTimeSeconds ?? 0);
      assert.equal(solverModelSchema.safeParse(model).success, true);
      return solveTinyModel(model);
    },
  );
  const context = fixture();
  context.stockItems[0]!.isUsed = false;
  const before = structuredClone(context);
  const result = await new CuttingPlanOptimizer(solver).optimize(context, {
    maxTimeSeconds: 2,
  });
  assert.equal(result.status, 'feasible');
  assert.equal(models.length, 4);
  assert.ok(budgets.every((value, i) => i === 0 || value < budgets[i - 1]!));
  assert.equal(
    models[3]!.constraints.length,
    models[0]!.constraints.length + 3,
  );
  assert.deepEqual(context, before);
});

test('a feasible incumbent ends refinement; unknown or timeout preserves a previous incumbent', async (t) => {
  for (const outcome of ['feasible', 'unknown', 'timeout'] as const) {
    const solver = client();
    let calls = 0;
    t.mock.method(solver, 'solve', async (model: SolverModel) => {
      calls++;
      const solved = solveTinyModel(model);
      if (outcome === 'feasible' && solved.status === 'optimal')
        return { ...solved, status: 'feasible' as const };
      if (calls === 1) return solved;
      if (outcome === 'timeout') throw new SolverError('timeout', 'Deadline');
      return { status: 'unknown' as const, wallTimeSeconds: 0.1 };
    });
    assert.equal(
      (await new CuttingPlanOptimizer(solver).optimize(fixture())).status,
      'feasible',
    );
    assert.equal(calls, outcome === 'feasible' ? 1 : 2);
  }
});

test('unknown, invalid models, invalid decoded output, operational failures, and cancellation stay distinct', async (t) => {
  for (const failure of [
    'unknown',
    'invalid',
    'corrupt',
    'unavailable',
    'cancelled',
    'timeout',
  ] as const) {
    const solver = client();
    const abort = new AbortController();
    t.mock.method(solver, 'solve', async (model: SolverModel) => {
      if (failure === 'unavailable' || failure === 'timeout')
        throw new SolverError(failure, 'Failure');
      if (failure === 'cancelled') {
        abort.abort();
        return { status: 'unknown' as const, wallTimeSeconds: 0 };
      }
      if (failure === 'unknown')
        return { status: 'unknown' as const, wallTimeSeconds: 0.1 };
      if (failure === 'invalid')
        return { status: 'model_invalid' as const, wallTimeSeconds: 0 };
      const result = solveTinyModel(model);
      if (result.status === 'optimal') result.values.x0 = 999;
      return result;
    });
    const pending = new CuttingPlanOptimizer(solver).optimize(fixture(), {
      signal: abort.signal,
    });
    if (failure === 'unknown' || failure === 'timeout')
      assert.deepEqual(await pending, {
        status: 'unknown',
        reason: 'search_limit',
      });
    else
      await assert.rejects(pending, {
        code:
          failure === 'invalid'
            ? 'invalid_model'
            : failure === 'corrupt'
              ? 'invalid_solution'
              : failure,
      });
  }
});

test('bounded candidate failure never claims infeasibility', async (t) => {
  const context = fixture();
  context.stockItems[0]!.widthMm = 100;
  context.requirements = Array.from({ length: 20 }, (_, i) => ({
    ...context.requirements[0]!,
    id: id(i + 1),
    widthMm: 1,
    quantity: 1,
  }));
  const solver = client();
  t.mock.method(solver, 'solve', async () => ({
    status: 'infeasible' as const,
    wallTimeSeconds: 0,
  }));
  assert.deepEqual(await new CuttingPlanOptimizer(solver).optimize(context), {
    status: 'unknown',
    reason: 'search_limit',
  });
  assert.deepEqual(await new CuttingPlanOptimizer(solver).optimize(fixture()), {
    status: 'infeasible',
  });
});

test('model construction enforces resource and exact numeric limits', async () => {
  const context = fixture();
  const candidates = await generatePatterns(context);
  const large = {
    ...candidates,
    assignments: Array.from({ length: 6000 }, (_, i) => ({
      ...candidates.assignments[0]!,
      stock: { ...context.stockItems[0]!, id: id(i + 100), isRemnant: true },
    })),
  };
  assert.equal(buildCuttingModel(context, large), null);
  const compiled = buildCuttingModel(context, candidates)!;
  assert.equal(modelFitsTransport(compiled.model, 5), true);
  const tooLarge = {
    ...compiled.model,
    variables: Array.from(
      { length: 10001 },
      () => compiled.model.variables[0]!,
    ),
  };
  assert.equal(modelFitsTransport(tooLarge, 5), false);
  assert.equal(
    modelFitsTransport(
      {
        ...compiled.model,
        constraints: [
          {
            terms: [],
            operator: '==',
            rhs: 0,
            onlyEnforceIf: [{ variable: 'x'.repeat(4 * 1024 * 1024) }],
          },
        ],
      },
      5,
    ),
    false,
  );
  const unsafe = {
    ...candidates,
    assignments: [
      {
        ...candidates.assignments[0]!,
        pattern: {
          ...candidates.assignments[0]!.pattern,
          waste: 9007199254740993n,
        },
      },
      {
        ...candidates.assignments[0]!,
        pattern: { ...candidates.assignments[0]!.pattern, waste: 1n },
      },
    ],
  };
  assert.throws(() => buildCuttingModel(context, unsafe), {
    code: 'numeric_range',
  });
});

test('normalizes identifiers before duplicate detection', () => {
  const context = fixture();
  context.requirements[0]!.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  context.requirements.push({
    ...context.requirements[0]!,
    id: context.requirements[0]!.id.toUpperCase(),
  });
  assert.throws(() => parseOptimizationContext(context), {
    code: 'invalid_input',
  });
});

test('model-size exhaustion returns unknown without contacting the solver', async (t) => {
  const context = fixture();
  context.stockItems = Array.from({ length: 6000 }, (_, i) => ({
    ...context.stockItems[0]!,
    id: id(i + 100),
    isRemnant: true,
  }));
  const solver = client();
  const spy = t.mock.method(solver, 'solve', async () => {
    throw new Error('Must not solve');
  });
  assert.deepEqual(await new CuttingPlanOptimizer(solver).optimize(context), {
    status: 'unknown',
    reason: 'model_limit',
  });
  assert.equal(spy.mock.callCount(), 0);
});

test('search budget exhaustion keeps its incumbent and never starts another pass', async (t) => {
  const solver = client();
  const spy = t.mock.method(solver, 'solve', async (model: SolverModel) => ({
    ...solveTinyModel(model),
    wallTimeSeconds: 1,
  }));
  assert.equal(
    (
      await new CuttingPlanOptimizer(solver).optimize(fixture(), {
        maxTimeSeconds: 0.5,
      })
    ).status,
    'feasible',
  );
  assert.equal(spy.mock.callCount(), 1);
});

test('remnant accounting tampering is rejected even if the decoded cuts themselves are valid', async (t) => {
  const context = fixture();
  context.stockItems[0]!.isRemnant = true;
  const solver = client();
  t.mock.method(solver, 'solve', async (model: SolverModel) => {
    const result = solveTinyModel(model);
    if (result.status === 'optimal') {
      const waste = Object.keys(result.values).find((name) =>
        name.startsWith('w'),
      )!;
      result.values[waste] = 1;
    }
    return result;
  });
  await assert.rejects(new CuttingPlanOptimizer(solver).optimize(context), {
    code: 'invalid_solution',
  });
});
