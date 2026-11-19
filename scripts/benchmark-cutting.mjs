/** Run after the API test build. The inventory is a read-only JSON snapshot
 * of cutting stock with a "code" field identifying its benchmark color. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { CuttingPlanOptimizer } from '../apps/api/.test-dist/features/allocations/optimizer/cutting-plan-optimizer.js';
import { id } from '../apps/api/.test-dist/features/allocations/optimizer/optimizer.fixtures.js';
import { validateCuttingPlan } from '../apps/api/.test-dist/features/allocations/cutting-plan/cutting-plan.validator.js';
import { SolverClient } from '../apps/api/.test-dist/solver/solver.client.js';
import { startSolver } from '../apps/api/.test-dist/testing/live-solver.js';

const [file, count, profile, mode = 'first'] = process.argv.slice(2);
const n = Number(count);
const profiles = ['repeated', 'mixed', 'fragmented'];
if (
  !file ||
  ![128, 256, 512].includes(n) ||
  !profiles.includes(profile) ||
  !['first', 'refine'].includes(mode)
) {
  throw new Error(
    'Usage: node scripts/benchmark-cutting.mjs inventory.json 128|256|512 repeated|mixed|fragmented first|refine',
  );
}
const inventory = JSON.parse(readFileSync(file, 'utf8'));
const index = profiles.indexOf(profile);
const colors = [...new Set(inventory.map((s) => s.code))]
  .sort()
  .slice(0, [1, 2, 4][index]);
assert.equal(colors.length, [1, 2, 4][index]);
const sizes = [1, 32, n][index];
const inches = (x) => Math.round(x * 25400) / 1000;
const requirements = Array.from({ length: sizes }, (_, i) => ({
  id: id(i + 1),
  fabricColorId: inventory.find((s) => s.code === colors[i % colors.length])
    .fabricColorId,
  widthMm: inches(sizes === 1 ? 46 : 22 + ((i * 11) % 97) / 2),
  lengthMm: inches(sizes === 1 ? 72 : 46 + ((i * 23) % 131) / 2),
  lengthAllowanceMm: 254,
  quantity: n / sizes,
}));
const stockItems = inventory
  .filter((s) => colors.includes(s.code))
  .map(({ code, ...s }, i) => {
    if (profile === 'fragmented' && !s.isRemnant && s.reservedLengthMm === 0) {
      if (i % 3 === 0) {
        s.isUsed = true;
        s.remainingLengthMm = Math.floor(s.remainingLengthMm * 0.27);
      }
      if (i % 3 === 1)
        s.reservedLengthMm = Math.floor(s.remainingLengthMm * 0.7);
    }
    return s;
  });
const context = {
  requirements,
  stockItems,
  settings: {
    edgeTrimMm: 25.4,
    minimumRemnantWidthMm: 1524,
    minimumRemnantLengthMm: 1524,
  },
};
const cleanup = [];
try {
  const client =
    mode === 'refine'
      ? new SolverClient(await startSolver({ after: (fn) => cleanup.push(fn) }))
      : null;
  if (client) cleanup.push(() => client.onModuleDestroy());
  const optimizer = new CuttingPlanOptimizer(client, undefined, (error) => {
    throw error;
  });
  const start = Date.now(),
    clock = performance.now();
  let firstMs, firstSummary;
  const metrics = ({ cuts }, s) => ({
    cuts: cuts.length,
    newRolls: s.newRollCount,
    items: s.stockItemCount,
    wasteAreaMm2: s.wasteAreaMm2,
  });
  const result = await optimizer.optimize(context, {}, async (result) => {
    firstMs = performance.now() - clock;
    firstSummary = metrics(result.plan, result.summary);
  });
  const elapsedMs = performance.now() - clock,
    end = Date.now();
  assert.equal(result.status, 'feasible');
  assert.ok(validateCuttingPlan(context, result.plan).valid);
  console.log(
    JSON.stringify({
      n,
      profile,
      mode,
      start,
      end,
      firstMs,
      elapsedMs,
      firstSummary,
      finalSummary: metrics(result.plan, result.summary),
      nodePeakMiB: process.resourceUsage().maxRSS / 1024,
    }),
  );
} finally {
  for (const fn of cleanup.reverse()) await fn();
}
