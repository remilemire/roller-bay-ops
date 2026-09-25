import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import type {
  CreateAllocation,
  CuttingContext,
} from '@roller-bay/shared/allocations';
import { allocationDetailSchema } from '@roller-bay/shared/allocations';
import request from 'supertest';
import { startSignedInApp } from '../../../testing/integration-app.js';
import { validateCuttingPlan } from '../cutting-plan/cutting-plan.validator.js';
import { CuttingPlanOptimizer } from '../optimizer/cutting-plan-optimizer.js';

/**
 * The signed-in app with what every allocation suite needs: one color and
 * location, scheduled orders to allocate against, stock and request builders,
 * and an optimizer that answers without the solver.
 */
export async function startAllocationsApp(t: TestContext) {
  const harness = await startSignedInApp(t);
  const { app, pool, cookie, origin, fixtures } = harness;
  const server = app.getHttpServer();
  const path = '/api/allocations';
  const get = (url: string) => request(server).get(url).set('Cookie', cookie);
  const post = (url: string, body: object, key: string = randomUUID()) =>
    request(server)
      .post(url)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', key)
      .send(body);
  const put = (id: string, body: object) =>
    request(server)
      .put(`${path}/${id}`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send(body);
  const ids = await fixtures.createColorAndLocation();
  const seed = async (length = 10000, remnant = false) => {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO fabric_stock_items (id, fabric_color_id, width_mm, initial_length_mm, explicit_length_mm, location_id, is_remnant, is_used)
      VALUES ($1, $2, 1200, $3, $4, $5, $6, $6)`,
      [id, ids.color, length, remnant ? length : null, ids.location, remnant],
    );
    return id;
  };
  // Sequential numbers keep order-number searches unambiguous.
  let orderNumber = 100000;
  /** A new order of one blind, that blind, and the plan that cuts it from the stock. */
  const input = async (
    stockId: string,
    length = 1000,
  ): Promise<CreateAllocation> => {
    const order = await fixtures.createWorkOrder(String(++orderNumber));
    const requirementId = randomUUID();
    return {
      workOrderId: order.id,
      requirements: [
        {
          id: requirementId,
          fabricColorId: ids.color,
          widthMm: 500,
          lengthMm: length,
          quantity: 1,
        },
      ],
      plan: {
        cuts: [
          {
            stockItemId: stockId,
            items: [{ requirementId, quantity: 1 }],
          },
        ],
      },
    };
  };
  /**
   * The same blinds under new ids, for another allocation or draft of the
   * order: a blind's id is unique across allocations. The plan follows them,
   * optionally cut from other stock.
   */
  const copy = (body: CreateAllocation, stockItemId?: string) => {
    const ids = new Map(
      body.requirements.map((item) => [item.id, randomUUID()]),
    );
    return {
      ...body,
      requirements: body.requirements.map((item) => ({
        ...item,
        id: ids.get(item.id)!,
      })),
      plan: {
        cuts: body.plan.cuts.map((cut) => ({
          stockItemId: stockItemId ?? cut.stockItemId,
          items: cut.items.map((item) => ({
            ...item,
            requirementId: ids.get(item.requirementId)!,
          })),
        })),
      },
    };
  };
  const create = async (body: CreateAllocation, key?: string) =>
    allocationDetailSchema.parse(
      (await post(path, body, key).expect(201)).body,
    );
  const countStock = async () =>
    Number(
      (
        await pool.query(
          `SELECT count(*) AS total FROM fabric_stock_items WHERE fabric_color_id=$1`,
          [ids.color],
        )
      ).rows[0].total,
    );
  const optimizer = app.get(CuttingPlanOptimizer);
  const optimizedContexts: CuttingContext[] = [];
  t.mock.method(optimizer, 'optimize', async (context: CuttingContext) => {
    optimizedContexts.push(context);
    const requirement = context.requirements[0]!;
    const stock = context.stockItems.find(
      (item) =>
        item.consumedAt === null &&
        item.remainingLengthMm - item.reservedLengthMm >=
          requirement.lengthMm + requirement.lengthAllowanceMm,
    )!;
    if (!stock) return { status: 'infeasible' as const };
    const plan = {
      cuts: [
        {
          stockItemId: stock.id,
          lengthMm: requirement.lengthMm + requirement.lengthAllowanceMm,
          items: [
            { requirementId: requirement.id, quantity: requirement.quantity },
          ],
        },
      ],
    };
    const validation = validateCuttingPlan(context, plan);
    assert.equal(validation.valid, true);
    if (!validation.valid) throw new Error('Invalid fixture plan');
    return { status: 'feasible' as const, plan, summary: validation.summary };
  });
  return {
    ...harness,
    server,
    path,
    ids,
    get,
    post,
    put,
    seed,
    input,
    copy,
    create,
    countStock,
    optimizedContexts,
  };
}
