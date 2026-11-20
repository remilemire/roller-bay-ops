/** Synthetic exact-fill instances with an independent, validated layout.
 * The observation window applies to this benchmark only. */
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { findFeasiblePlan } from '../apps/api/.test-dist/features/allocations/optimizer/feasibility-search.js';
import {
  fixture,
  id,
} from '../apps/api/.test-dist/features/allocations/optimizer/optimizer.fixtures.js';
import { validateCuttingPlan } from '../apps/api/.test-dist/features/allocations/cutting-plan/cutting-plan.validator.js';

const windowMs = Number(process.argv[2] ?? 2000);
assert.ok(Number.isSafeInteger(windowMs) && windowMs > 0);
function exactFill(groups, perCut) {
  const context = fixture();
  const base = context.requirements[0];
  context.requirements = [];
  const stock = context.stockItems[0];
  stock.widthMm = 1002;
  stock.remainingLengthMm = groups * 3;
  const witness = { cuts: [] };
  let state = 121;
  for (let group = 0; group < groups; group++) {
    const items = [];
    let left = 1000000;
    for (let i = 0; i < perCut; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const width =
        i === perCut - 1 ? left : Math.floor(900000 / perCut) + (state % 50000);
      left -= width;
      const requirement = {
        ...base,
        id: id(context.requirements.length + 1),
        widthMm: width / 1000,
        quantity: 1,
      };
      context.requirements.push(requirement);
      items.push({ requirementId: requirement.id, quantity: 1 });
    }
    witness.cuts.push({ stockItemId: stock.id, lengthMm: 3, items });
  }
  assert.ok(validateCuttingPlan(context, witness).valid);
  return context;
}
for (const perCut of [3, 4, 5]) {
  for (const groups of [2, 4, 6, 8, 10, 12]) {
    if (process.argv[3] && perCut !== Number(process.argv[3])) continue;
    if (process.argv[4] && groups !== Number(process.argv[4])) continue;
    const context = exactFill(groups, perCut);
    const counts = { placements: 0, backtracks: 0 };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), windowMs);
    const start = performance.now();
    let status;
    try {
      const result = await findFeasiblePlan(context, controller.signal, counts);
      assert.equal(result.status, 'feasible');
      assert.ok(validateCuttingPlan(context, result.plan).valid);
      status = result.status;
    } catch (error) {
      if (!controller.signal.aborted || error.code !== 'cancelled') throw error;
      status = 'observation_window_ended';
    } finally {
      clearTimeout(timer);
    }
    console.log(
      JSON.stringify({
        observationWindowMs: windowMs,
        perCut,
        groups,
        blinds: context.requirements.length,
        status,
        elapsedMs: performance.now() - start,
        ...counts,
      }),
    );
  }
}
