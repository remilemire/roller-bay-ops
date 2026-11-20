import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { allocationPlanningJobSchema } from '@roller-bay/shared/allocations';
import { startAllocationsApp } from './testing/allocations-app.js';
import { AllocationPlanningService } from './allocation-planning.service.js';
import { PlanningJobsService } from './planning-jobs.service.js';
import { CuttingPlanOptimizer } from './optimizer/cutting-plan-optimizer.js';

test(
  'a 512-line plan uses an available remnant through background search, draft save and confirmation',
  { timeout: 60000 },
  async (t) => {
    const { app, fixtures, seed, ids, put, get, post, path, pool } =
      await startAllocationsApp(t);
    const local = new CuttingPlanOptimizer(null);
    t.mock.method(
      app.get(CuttingPlanOptimizer),
      'optimize',
      local.optimize.bind(local),
    );
    const order = await fixtures.createWorkOrder('899990', 512);
    await seed(600000);
    const usedRollId = await seed(600000);
    await pool.query(
      'UPDATE fabric_stock_items SET width_mm = 1100, is_used = true, tube_outer_diameter_mm = 50 WHERE id = $1',
      [usedRollId],
    );
    const stockId = await seed(512000, true);
    const requirements = Array.from({ length: 512 }, (_, i) => ({
      id: randomUUID(),
      fabricColorId: ids.color,
      widthMm: 900 + i / 1000,
      lengthMm: 1000,
      quantity: 1,
    }));
    const job = 'planning-jobs/' + randomUUID();
    await put(job, { requirements }).expect(202);
    let state;
    do {
      await delay(15);
      state = allocationPlanningJobSchema.parse(
        (await get(`${path}/${job}`).expect(200)).body,
      );
    } while (state.status === 'searching' || state.status === 'refining');
    assert.equal(state.status, 'finished');
    assert.equal(state.result.status, 'feasible');
    if (state.result.status !== 'feasible') return;
    const plan = {
      cuts: state.result.plan.cuts.map(({ stockItemId, items }) => ({
        stockItemId,
        items,
      })),
    };
    assert.equal(state.result.summary.newRollCount, 0);
    assert.equal(plan.cuts.length, 512);
    assert.ok(
      Buffer.byteLength(JSON.stringify({ requirements, plan })) > 100 * 1024,
    );
    assert.equal(
      (await post(`${path}/validate`, { requirements, plan }).expect(200)).body
        .valid,
      true,
    );
    const { body: draft } = await post(`${path}/drafts`, {
      data: { workOrderId: order.id, requirements, plan },
    }).expect(201);
    const { body: confirmed } = await post(`${path}/${draft.id}/submit`, {
      expectedRevision: draft.revision,
    }).expect(200);
    assert.equal(confirmed.plan.cuts.length, 512);
    assert.equal(confirmed.items.length, 1);
    assert.equal(confirmed.items[0].stockItemId, stockId);
    assert.equal(confirmed.items[0].reservedLengthMm, 512000);
  },
);

test(
  'jobs expose the first validated plan, isolate owners, deduplicate retries, and recover on worker restart',
  { timeout: 30000 },
  async (t) => {
    const { app, server, origin, cookie, userId, put, get, input, seed, path } =
      await startAllocationsApp(t);
    const { requirements } = await input(await seed());
    const planning = app.get(AllocationPlanningService);
    const jobs = app.get(PlanningJobsService);
    const solve = planning.solve.bind(planning);
    let calls = 0;
    t.mock.method(
      planning,
      'solve',
      async (...args: Parameters<typeof solve>) => {
        calls++;
        const [snapshot, signal, onReady] = args;
        const plan = await solve(snapshot, signal);
        await onReady?.(plan);
        if (calls === 1) await delay(30000, undefined, { signal });
        return plan;
      },
    );
    const key = randomUUID(),
      route = 'planning-jobs/' + key,
      body = { requirements };
    await Promise.all([
      put(route, body).expect(202),
      put(route, body).expect(202),
    ]);
    async function wait(status: string) {
      for (;;) {
        const { body: state } = await get(`${path}/${route}`).expect(200);
        if (state.status === status) return state;
        await delay(20);
      }
    }
    await wait('refining');
    assert.equal(calls, 1);
    await put(route, {
      requirements: [{ ...requirements[0], quantity: 2 }],
    }).expect(409);
    await request(server).get(`${path}/${route}`).expect(401);
    await assert.rejects(jobs.status(randomUUID(), key), { status: 404 });
    await assert.rejects(jobs.cancel(randomUUID(), key), { status: 404 });
    const queued = randomUUID();
    await put('planning-jobs/' + queued, body).expect(202);
    await request(server)
      .delete(`${path}/planning-jobs/${queued}`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .expect(204);
    assert.equal((await jobs.status(userId, queued)).status, 'cancelled');

    await jobs.onModuleDestroy();
    const replacement = new PlanningJobsService(
      app.get(ConfigService),
      planning,
    );
    await replacement.onModuleInit();
    t.after(() => replacement.onModuleDestroy());
    let state;
    do {
      await delay(20);
      state = await replacement.status(userId, key);
    } while (state.status !== 'finished');
    assert.equal(state.result.status, 'feasible');
    assert.equal(calls, 1);
  },
);

test(
  'searching workers restart from the admitted stock snapshot and another replica can cancel active work',
  { timeout: 30000 },
  async (t) => {
    const { app, userId, input, seed, pool } = await startAllocationsApp(t);
    const stockId = await seed(10000);
    const { requirements } = await input(stockId);
    const planning = app.get(AllocationPlanningService);
    const original = app.get(PlanningJobsService);
    const config = app.get(ConfigService);
    const solve = planning.solve.bind(planning);
    const seen: number[] = [];
    let aborted = false;
    t.mock.method(
      planning,
      'solve',
      async (...args: Parameters<typeof solve>) => {
        const [snapshot, signal] = args;
        seen.push(
          snapshot.context.stockItems.find((s) => s.id === stockId)!
            .remainingLengthMm,
        );
        if (seen.length !== 2) {
          try {
            await delay(30000, undefined, { signal });
          } finally {
            aborted = signal?.aborted ?? false;
          }
        }
        return solve(...args);
      },
    );
    const id = randomUUID();
    await original.start(userId, id, { requirements });
    while (!seen.length) await delay(10);
    await original.onModuleDestroy();
    // The newer observed balance would no longer fit this order.
    await pool.query(
      'UPDATE fabric_stock_items SET initial_length_mm=10 WHERE id=$1',
      [stockId],
    );
    const replacement = new PlanningJobsService(config, planning);
    await replacement.onModuleInit();
    const other = new PlanningJobsService(config, planning);
    try {
      let state;
      do {
        await delay(10);
        state = await replacement.status(userId, id);
      } while (state.status !== 'finished');
      assert.equal(state.result.status, 'feasible');
      assert.deepEqual(seen, [10000, 10000]);
      const second = randomUUID();
      await replacement.start(userId, second, { requirements });
      while (seen.length < 3) await delay(10);
      aborted = false;
      await other.onModuleInit();
      await other.cancel(userId, second);
      while (!aborted) await delay(10);
      assert.equal((await other.status(userId, second)).status, 'cancelled');
    } finally {
      await Promise.all([
        replacement.onModuleDestroy(),
        other.onModuleDestroy(),
      ]);
    }
  },
);
