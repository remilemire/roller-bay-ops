import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  CuttingContext,
  CuttingPlan,
} from '@roller-bay/shared/allocations';
import { SolverClient } from '../../../solver/solver.client.js';
import { startSolver } from '../../../testing/live-solver.js';
import { validateCuttingPlan } from '../cutting-plan/cutting-plan.validator.js';
import {
  toLengthUnits,
  toMillimetres,
} from '../cutting-plan/cutting-dimensions.js';
import { CuttingPlanOptimizer } from './cutting-plan-optimizer.js';
import { allocatorFixture, fixture, id } from './optimizer.fixtures.js';
import type { CuttingPlanSummary } from '../cutting-plan/cutting-plan.types.js';

const score = (summary: CuttingPlanSummary) => [
  BigInt(summary.wasteAreaMm2.replace('.', '')),
  BigInt(summary.newRollCount),
  BigInt(summary.cutCount),
  BigInt(summary.stockItemCount),
];
const better = (a: bigint[], b: bigint[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! < b[i]!;
  return false;
};

// Independently partitions individual blinds into cuts, tries all stock choices,
// and scores only complete plans through the domain validator (no pattern/model reuse).
function exhaustiveReference(context: CuttingContext): bigint[] | null {
  const blinds = context.requirements.flatMap((item) =>
    Array.from({ length: item.quantity }, () => item),
  );
  assert.ok(blinds.length <= 5);
  let best: bigint[] | null = null;
  const cuts: CuttingPlan['cuts'] = [];
  const consumed = new Map<string, bigint>();
  const trim = toLengthUnits(context.settings.edgeTrimMm);
  function visit(mask: number): void {
    if (mask === 0) {
      const result = validateCuttingPlan(context, { cuts });
      if (result.valid) {
        const value = score(result.summary);
        if (!best || better(value, best)) best = value;
      }
      return;
    }
    const first = mask & -mask;
    for (let subset = mask; subset; subset = (subset - 1) & mask) {
      if (!(subset & first)) continue;
      const selected = blinds.filter((_, index) => subset & (1 << index));
      const color = selected[0]!.fabricColorId;
      if (selected.some((item) => item.fabricColorId !== color)) continue;
      const width = selected.reduce(
        (sum, item) => sum + toLengthUnits(item.widthMm),
        0n,
      );
      const length = selected.reduce((max, item) => {
        const value =
          toLengthUnits(item.lengthMm) + toLengthUnits(item.lengthAllowanceMm);
        return value > max ? value : max;
      }, 0n);
      const quantities = new Map<string, number>();
      for (const item of selected)
        quantities.set(item.id, (quantities.get(item.id) ?? 0) + 1);
      for (const stock of context.stockItems) {
        if (
          stock.fabricColorId !== color ||
          stock.consumedAt !== null ||
          (stock.isRemnant && stock.reservedLengthMm > 0) ||
          width + 2n * trim > toLengthUnits(stock.widthMm)
        )
          continue;
        const used = consumed.get(stock.id) ?? 0n;
        if (
          used + length >
          toLengthUnits(stock.remainingLengthMm) -
            toLengthUnits(stock.reservedLengthMm)
        )
          continue;
        consumed.set(stock.id, used + length);
        cuts.push({
          stockItemId: stock.id,
          lengthMm: toMillimetres(length),
          items: [...quantities].map(([requirementId, quantity]) => ({
            requirementId,
            quantity,
          })),
        });
        visit(mask ^ subset);
        cuts.pop();
        consumed.set(stock.id, used);
      }
    }
  }
  visit((1 << blinds.length) - 1);
  return best;
}

test('cutting optimizer against the real solver service', async (t) => {
  const client = new SolverClient(await startSolver(t));
  t.after(() => client.onModuleDestroy());
  const optimizer = new CuttingPlanOptimizer(client);
  async function compare(context: CuttingContext) {
    const expected = exhaustiveReference(context);
    const actual = await optimizer.optimize(context, { maxTimeSeconds: 5 });
    if (!expected) {
      assert.equal(actual.status, 'infeasible');
      return null;
    }
    assert.equal(actual.status, 'feasible');
    if (actual.status !== 'feasible') throw new Error(JSON.stringify(actual));
    assert.deepEqual(score(actual.summary), expected);
    assert.equal(validateCuttingPlan(context, actual.plan).valid, true);
    return actual;
  }

  await t.test(
    'tiny exhaustive reference agrees for repeated quantities, mixed lengths and decimal allowances',
    async () => {
      await compare(fixture());
      const context = fixture();
      context.requirements[0]!.quantity = 1;
      context.requirements.push({
        ...context.requirements[0]!,
        id: id(2),
        widthMm: 3.125,
        lengthMm: 4.003,
        lengthAllowanceMm: 0.127,
      });
      await compare(context);
    },
  );
  await t.test(
    'less waste wins even when it requires opening a new roll',
    async () => {
      const context = fixture();
      context.stockItems[0]!.widthMm = 7;
      context.stockItems.push({
        ...context.stockItems[0]!,
        id: id(21),
        widthMm: 10,
        isUsed: false,
      });
      const result = await compare(context);
      assert.equal(result?.summary.newRollCount, 1);
    },
  );
  await t.test(
    'equal waste prefers no new rolls before fewer cuts',
    async () => {
      const context = fixture();
      context.settings.minimumRemnantWidthMm = 100;
      context.stockItems[0]!.widthMm = 6;
      context.stockItems.push({
        ...context.stockItems[0]!,
        id: id(21),
        widthMm: 12,
        isUsed: false,
      });
      const result = await compare(context);
      assert.equal(result?.summary.newRollCount, 0);
      assert.equal(result?.summary.cutCount, 2);
    },
  );
  await t.test(
    'fewer cuts and then fewer stock items break remaining ties',
    async () => {
      const result = await compare(fixture());
      assert.equal(result?.summary.cutCount, 1);
      const context = fixture();
      context.stockItems[0]!.widthMm = 6;
      context.stockItems.push(
        { ...context.stockItems[0]!, id: id(21), remainingLengthMm: 3 },
        { ...context.stockItems[0]!, id: id(22), remainingLengthMm: 3 },
      );
      const selected = await compare(context);
      assert.equal(selected?.summary.stockItemCount, 1);
    },
  );
  await t.test(
    'remnant tail is counted once across multiple cuts and thresholds are inclusive',
    async () => {
      for (const length of [6, 7, 8, 9]) {
        const context = fixture();
        context.settings.minimumRemnantWidthMm = 6;
        Object.assign(context.stockItems[0]!, {
          isRemnant: true,
          widthMm: 6,
          remainingLengthMm: length,
        });
        const result = await compare(context);
        assert.equal(result?.summary.cutCount, 2);
        assert.equal(result?.summary.reservations[0]?.reservedLengthMm, length);
        const tail = result?.summary.leftovers.find(
          (item) => item.kind === 'remnant-tail',
        );
        if (length > 6) assert.equal(tail?.reusable, length >= 8);
      }
    },
  );
  await t.test(
    'shortening offcuts and remnant width threshold agree with the reference',
    async () => {
      const context = fixture();
      context.requirements[0]!.quantity = 1;
      context.requirements.push({
        ...context.requirements[0]!,
        id: id(2),
        lengthMm: 5,
      });
      Object.assign(context.stockItems[0]!, {
        isRemnant: true,
        remainingLengthMm: 11,
      });
      await compare(context);
      context.settings.minimumRemnantWidthMm = 11;
      await compare(context);
    },
  );
  await t.test(
    'reserved remnants, consumed stock and partially reserved rolls are handled',
    async () => {
      const context = fixture();
      context.stockItems[0]!.reservedLengthMm = 6;
      context.stockItems.push(
        {
          ...context.stockItems[0]!,
          id: id(21),
          isRemnant: true,
          reservedLengthMm: 1,
        },
        {
          ...context.stockItems[0]!,
          id: id(22),
          consumedAt: '2026-09-16T00:00:00Z',
          reservedLengthMm: 0,
        },
      );
      await compare(context);
      context.stockItems[0]!.reservedLengthMm = 7;
      await compare(context);
    },
  );
  await t.test(
    'aggregate shortage is proven infeasible without confusing it with missing patterns',
    async () => {
      const context = fixture();
      context.stockItems[0]!.widthMm = 6;
      context.stockItems[0]!.remainingLengthMm = 3;
      await compare(context);
    },
  );
  await t.test(
    'supports 100 individual blinds and bounded mixed-requirement search',
    async () => {
      const context = fixture();
      context.requirements[0]!.quantity = 100;
      context.stockItems[0]!.remainingLengthMm = 300;
      const hundred = await optimizer.optimize(context, {
        maxTimeSeconds: 5,
      });
      assert.equal(hundred.status, 'feasible');
      if (hundred.status !== 'feasible')
        throw new Error(JSON.stringify(hundred));
      assert.equal(hundred.summary.cutCount, 50);
      assert.equal(
        hundred.plan.cuts.reduce(
          (total, cut) =>
            total + cut.items.reduce((sum, item) => sum + item.quantity, 0),
          0,
        ),
        100,
      );
      context.requirements = Array.from({ length: 20 }, (_, i) => ({
        ...context.requirements[0]!,
        id: id(i + 1),
        widthMm: 1,
        quantity: 1,
      }));
      context.stockItems[0]!.widthMm = 100;
      const bounded = await optimizer.optimize(context, {
        maxTimeSeconds: 5,
      });
      assert.equal(bounded.status, 'feasible');
      if (bounded.status === 'feasible')
        assert.equal(validateCuttingPlan(context, bounded.plan).valid, true);
    },
  );
  await t.test(
    'allocator example produces a fully validated plan across both colors',
    async () => {
      const context = allocatorFixture();
      const result = await optimizer.optimize(context, { maxTimeSeconds: 5 });
      assert.equal(result.status, 'feasible');
      if (result.status !== 'feasible') throw new Error(JSON.stringify(result));
      assert.equal(validateCuttingPlan(context, result.plan).valid, true);
      const quantities = new Map<string, number>();
      for (const cut of result.plan.cuts)
        for (const item of cut.items)
          quantities.set(
            item.requirementId,
            (quantities.get(item.requirementId) ?? 0) + item.quantity,
          );
      for (const requirement of context.requirements)
        assert.equal(quantities.get(requirement.id), requirement.quantity);
    },
  );
});
