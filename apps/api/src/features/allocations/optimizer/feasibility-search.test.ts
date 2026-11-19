import { SolverClient } from '../../../solver/solver.client.js';
import { SolverError } from '../../../solver/solver.errors.js';
import type { SolverModel } from '../../../solver/solver.contracts.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  planningDefaults,
  planningSettingsSchema,
} from '../../../config/planning.js';
import { validateCuttingPlan } from '../cutting-plan/cutting-plan.validator.js';
import { CuttingPlanOptimizer } from './cutting-plan-optimizer.js';
import { findFeasiblePlan } from './feasibility-search.js';
import { exhaustiveReference } from './exhaustive-reference.test-helper.js';
import { fixture, id } from './optimizer.fixtures.js';
import { generatePatterns } from './pattern-generation.js';
import { buildCuttingModel } from './cutting-model.js';

function tight(widths: number[]) {
  const context = fixture();
  context.requirements = widths.map((widthMm, i) => ({
    ...context.requirements[0]!,
    id: id(i + 1),
    widthMm,
    quantity: 1,
  }));
  Object.assign(context.stockItems[0]!, { widthMm: 12, remainingLengthMm: 6 });
  return context;
}
test('backtracks past a failed first fit and proves an equal-area shortage', async () => {
  const context = tight([2, 6, 3, 2, 1, 5, 9, 2]);
  context.stockItems[0]!.remainingLengthMm = 9;
  const before = structuredClone(context);
  const counts = { placements: 0, backtracks: 0 };
  const result = await findFeasiblePlan(context, undefined, counts);
  assert.equal(result.status, 'feasible');
  assert.ok(counts.backtracks > 0);
  assert.deepEqual(context, before);
  assert.deepEqual(await findFeasiblePlan(tight([6, 6, 6, 2])), {
    status: 'infeasible',
  });
});
test('backtracks on used stock before opening a sealed roll even when the sealed layout is simpler', async () => {
  const context = tight([2, 6, 3, 2, 1, 5, 9, 2]);
  const used = context.stockItems[0]!;
  used.remainingLengthMm = 9;
  context.stockItems.push({ ...used, id: id(21), widthMm: 32, isUsed: false });
  const counts = { placements: 0, backtracks: 0 };
  const result = await findFeasiblePlan(context, undefined, counts);
  assert.equal(result.status, 'feasible');
  if (result.status !== 'feasible') return;
  assert.ok(counts.backtracks > 0);
  assert.equal(result.summary.newRollCount, 0);
  assert.deepEqual(
    new Set(result.plan.cuts.map((c) => c.stockItemId)),
    new Set([used.id]),
  );
});

test('a necessary roll must fit the whole color allocation within the minimum number of openings', async () => {
  const context = tight([8, 4, 4]);
  const base = context.stockItems[0]!;
  context.stockItems = [
    {
      ...base,
      widthMm: 10,
      remainingLengthMm: 3,
      reservedLengthMm: 1,
      isRemnant: true,
    },
    { ...base, id: id(21), widthMm: 6, remainingLengthMm: 9, isUsed: false },
    { ...base, id: id(22), widthMm: 10, remainingLengthMm: 6, isUsed: false },
    {
      ...base,
      id: id(23),
      widthMm: 10,
      remainingLengthMm: 6,
      reservedLengthMm: 3,
      isUsed: false,
    },
  ];
  const result = await findFeasiblePlan(context);
  assert.equal(result.status, 'feasible');
  if (result.status !== 'feasible') return;
  assert.equal(result.summary.newRollCount, 1);
  assert.deepEqual(
    new Set(result.plan.cuts.map((c) => c.stockItemId)),
    new Set([id(22)]),
  );
});

test('512 blinds use sixteen opened items before exactly the necessary extra rolls', async () => {
  const context = fixture();
  const base = context.stockItems[0]!;
  context.stockItems = Array.from({ length: 207 }, (_, i) => ({
    ...base,
    id: id(20 + i),
    remainingLengthMm: i < 16 ? 24 : 96,
    isRemnant: i < 8,
    isUsed: i >= 8 && i < 16,
  }));
  // Two blinds per cut. Open stock carries 256 blinds and each sealed roll 64.
  for (const [quantity, openings] of [
    [256, 0],
    [257, 1],
    [512, 4],
  ] as const) {
    context.requirements[0]!.quantity = quantity;
    const result = await new CuttingPlanOptimizer(null).optimize(context);
    assert.equal(result.status, 'feasible');
    if (result.status !== 'feasible') return;
    assert.equal(result.summary.newRollCount, openings);
    assert.ok(validateCuttingPlan(context, result.plan).valid);
  }
});

test('agrees with independent exhaustive partitions on 1000 seeded small orders', async () => {
  let seed = 4219,
    feasible = 0;
  const random = (limit: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return Math.floor((seed / 2 ** 32) * limit);
  };
  for (let i = 0; i < 1000; i++) {
    const context = fixture();
    context.requirements = Array.from({ length: 1 + random(4) }, (_, j) => ({
      ...context.requirements[0]!,
      id: id(j + 1),
      fabricColorId: id(10 + (i % 2 ? 0 : random(2))),
      widthMm: 1 + random(6),
      lengthMm: 1 + random(5),
      lengthAllowanceMm: random(2) * 0.125,
      quantity: j === 0 ? 1 + random(2) : 1,
    }));
    context.stockItems = Array.from({ length: 2 + random(2) }, (_, j) => ({
      ...context.stockItems[0]!,
      id: id(20 + j),
      fabricColorId: id(10 + (i % 2 ? 0 : j % 2)),
      isRemnant: random(4) === 0,
      isUsed: random(2) === 0,
      voidedAt: random(16) === 0 ? '2026-11-01T00:00:00Z' : null,
      reservedLengthMm: random(3),
      widthMm: 3 + random(9),
      remainingLengthMm: 2 + random(12),
    }));
    const expected = exhaustiveReference(context);
    const actual = await findFeasiblePlan(context);
    assert.equal(
      actual.status,
      expected ? 'feasible' : 'infeasible',
      `fixture ${i}`,
    );
    if (actual.status === 'feasible') {
      feasible++;
      assert.equal(
        BigInt(actual.summary.newRollCount),
        expected![0],
        `opening count for fixture ${i}`,
      );
      assert.ok(validateCuttingPlan(context, actual.plan).valid);
    }
  }
  assert.ok(feasible > 100 && feasible < 900);
});
test('one roll may carry 512 distinct cuts and refinement preserves their placements', async () => {
  const context = fixture();
  Object.assign(context.stockItems[0]!, {
    widthMm: 6,
    remainingLengthMm: 1536,
  });
  context.requirements[0]!.quantity = 512;
  const result = await new CuttingPlanOptimizer(null).optimize(context);
  assert.equal(result.status, 'feasible');
  if (result.status !== 'feasible') return;
  assert.equal(result.plan.cuts.length, 512);
  const candidates = await generatePatterns(
    context,
    undefined,
    { patterns: 1, nodes: 1, assignments: 1 },
    result.plan,
  );
  assert.equal(candidates.assignments.length, 1);
  assert.equal(candidates.assignments[0]!.maximum, 512);
  const model = buildCuttingModel(context, candidates)!;
  assert.ok(
    model.model.constraints.some((rule) =>
      rule.terms.some((term) => term.coefficient === -512),
    ),
  );
  await assert.rejects(
    new CuttingPlanOptimizer(null, {
      ...planningDefaults,
      CUTTING_MAX_BLINDS: 511,
    }).optimize(context),
    { code: 'invalid_input' },
  );
});
test('the refinement budget can be smaller than the known plan without constraining feasibility', async () => {
  const context = tight([6, 5, 3, 2, 2, 2]);
  const result = await findFeasiblePlan(context);
  assert.equal(result.status, 'feasible');
  if (result.status !== 'feasible') return;
  const limited = await generatePatterns(
    context,
    undefined,
    { patterns: 1, nodes: 1, assignments: 1 },
    result.plan,
  );
  assert.equal(limited.complete, false);
  assert.equal(limited.impossible, false);
  assert.equal(buildCuttingModel(context, limited), null);
});
test('a long exact search yields to cancellation; invalid job and refinement settings fail startup', async () => {
  const context = tight(
    Array.from({ length: 36 }, (_, i) => 100 + ((i * 197) % 83)),
  );
  const total = context.requirements.reduce((sum, r) => sum + r.widthMm, 0);
  // All pieces are even, but both equal bins have odd capacity. A pure
  // area check passes, so a large search is available to interrupt.
  for (const r of context.requirements) r.widthMm *= 2;
  context.requirements[0]!.widthMm += total % 2 === 0 ? 2 : 0;
  context.stockItems[0]!.widthMm = 2 + total + (total % 2 === 0 ? 1 : 0);
  const controller = new AbortController();
  const pending = findFeasiblePlan(context, controller.signal);
  setImmediate(() => controller.abort());
  await assert.rejects(pending, { code: 'cancelled' });
  for (const settings of [
    { CUTTING_JOB_CONCURRENCY: 0 },
    { CUTTING_MAX_BLINDS: 10001 },
    { CUTTING_MAX_ASSIGNMENTS: -1 },
    { CUTTING_REFINEMENT_SECONDS: 61 },
  ])
    assert.equal(planningSettingsSchema.safeParse(settings).success, false);
});

test('optional solver failures and worse feasible solutions preserve the published plan', async (t) => {
  for (const outcome of ['unavailable', 'worse'] as const) {
    const solver = new SolverClient({
      baseUrl: 'http://solver.test',
      apiKey: 'x'.repeat(32),
    });
    t.after(() => solver.onModuleDestroy());
    t.mock.method(solver, 'solve', async (model: SolverModel) => {
      if (outcome === 'unavailable')
        throw new SolverError('unavailable', 'Solver unavailable');
      // Use two single-blind cuts instead of the known double-width cut.
      const values = Object.fromEntries(
        model.variables.map((v) => [
          v.name,
          v.name === 's0'
            ? 1
            : v.name.startsWith('x') && v.upperBound === 2
              ? 2
              : 0,
        ]),
      );
      return {
        status: 'feasible' as const,
        values,
        wallTimeSeconds: 0.01,
        objectiveValue: 0,
        bestObjectiveBound: 0,
      };
    });
    const errors: unknown[] = [];
    const optimizer = new CuttingPlanOptimizer(
      solver,
      planningDefaults,
      (error) => errors.push(error),
    );
    const context = fixture();
    context.settings.minimumRemnantWidthMm = 100;
    const first = await findFeasiblePlan(context);
    let published = false;
    const result = await optimizer.optimize(context, {}, async (plan) => {
      assert.deepEqual(plan, first);
      published = true;
    });
    assert.ok(published);
    assert.deepEqual(result, first);
    assert.equal(errors.length, outcome === 'unavailable' ? 1 : 0);
  }
});
