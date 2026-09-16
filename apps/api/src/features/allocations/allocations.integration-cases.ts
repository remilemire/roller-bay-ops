import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/environment.js';
import { testAllocationDrafts } from './allocation-drafts.integration-cases.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'pg';
import request from 'supertest';
import {
  allocationDetailSchema,
  allocationListSchema,
  type CreateAllocation,
  type CuttingContext,
} from '@roller-bay/shared/allocations';
import { StockItemsRepository } from '../stock-items/stock-items.repository.js';
import { CuttingPlanOptimizer } from './optimizer/cutting-plan-optimizer.js';
import { validateCuttingPlan } from './cutting-plan/cutting-plan.validator.js';

export async function testAllocations(
  t: TestContext,
  app: INestApplication,
  pool: Pool,
  schema: string,
  cookie: string,
  userId: string,
  origin: string,
) {
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
  const ids = {
    maker: randomUUID(),
    material: randomUUID(),
    color: randomUUID(),
    zone: randomUUID(),
    section: randomUUID(),
    location: randomUUID(),
  };
  const seed = async (length = 10000, remnant = false) => {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO "${schema}".fabric_stock_items (id, fabric_color_id, width_mm, initial_length_mm, explicit_length_mm, location_id, is_remnant, is_used)
      VALUES ($1, $2, 1200, $3, $4, $5, $6, $6)`,
      [id, ids.color, length, remnant ? length : null, ids.location, remnant],
    );
    return id;
  };
  const input = (stockId: string, length = 1000): CreateAllocation => {
    const requirementId = randomUUID();
    return {
      orderNumber: `ORDER-${randomUUID().slice(0, 8)}`,
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
        drops: [
          {
            stockItemId: stockId,
            lengthMm: length,
            items: [{ requirementId, quantity: 1 }],
          },
        ],
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
          `SELECT count(*) AS total FROM "${schema}".fabric_stock_items WHERE fabric_color_id=$1`,
          [ids.color],
        )
      ).rows[0].total,
    );
  const optimizer = app.get(CuttingPlanOptimizer);
  const optimizedContexts: CuttingContext[] = [];
  const mock = t.mock.method(
    optimizer,
    'optimize',
    async (context: CuttingContext) => {
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
        drops: [
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
    },
  );
  try {
    await pool.query(
      `INSERT INTO "${schema}".manufacturers (id,name) VALUES ($1,'Allocation manufacturer')`,
      [ids.maker],
    );
    await pool.query(
      `INSERT INTO "${schema}".fabric_materials (id,manufacturer_id,name) VALUES ($1,$2,'Allocation material')`,
      [ids.material, ids.maker],
    );
    await pool.query(
      `INSERT INTO "${schema}".fabric_colors (id,material_id,code,thickness_mm) VALUES ($1,$2,'ALLOC-TEST',0.5)`,
      [ids.color, ids.material],
    );
    await pool.query(
      `INSERT INTO "${schema}".location_zones (id,name) VALUES ($1,'Allocation warehouse')`,
      [ids.zone],
    );
    await pool.query(
      `INSERT INTO "${schema}".location_sections (id,zone_id,label) VALUES ($1,$2,'A')`,
      [ids.section, ids.zone],
    );
    await pool.query(
      `INSERT INTO "${schema}".locations (id,section_id,label) VALUES ($1,$2,'1')`,
      [ids.location, ids.section],
    );
    await pool.query(
      `UPDATE "${schema}".users SET role='user', is_active=true WHERE id=$1`,
      [userId],
    );

    await t.test(
      'allocation routes require auth and origin checks, but normal users may operate the workflow',
      async () => {
        await request(server).get(path).expect(401);
        const body = input(await seed());
        await request(server)
          .post(path)
          .set('Cookie', cookie)
          .send(body)
          .expect(403);
        await request(server)
          .post(path)
          .set('Cookie', cookie)
          .set('Origin', origin)
          .send(body)
          .expect(400);
        const result = await create(body);
        assert.equal(result.state, 'active');
        assert.equal(result.revision, 1);
        assert.equal(result.items[0]!.stockItem.remainingLengthMm, 10000);
        assert.equal(result.items[0]!.reservedLengthMm, 1000);
        await request(server)
          .patch(`/api/stock-items/${result.items[0]!.stockItemId}`)
          .set('Cookie', cookie)
          .set('Origin', origin)
          .send({ widthMm: 1000 })
          .expect(403);
        await get(`${path}/${randomUUID()}`).expect(404);
      },
    );

    await t.test(
      'previews use authoritative snapshots, exclude own reservations, and do not write',
      async () => {
        const stockId = await seed(1000);
        const body = input(stockId);
        const allocation = await create(body);
        const { requirements, plan } = body;
        const blocked = await post(`${path}/validate`, {
          requirements,
          plan,
        }).expect(200);
        assert.equal(blocked.body.valid, false);
        const valid = await post(`${path}/validate`, {
          requirements,
          plan,
          allocationId: allocation.id,
          expectedRevision: 1,
        }).expect(200);
        assert.equal(valid.body.valid, true);
        assert.equal(valid.body.stockItems[0].locationLabel, '1');
        await post(`${path}/validate`, {
          requirements,
          plan,
          stockItems: [],
        }).expect(400);
        await post(`${path}/optimize`, {
          requirements,
          allocationId: allocation.id,
          expectedRevision: 1,
        }).expect(200);
        assert.equal(
          optimizedContexts
            .at(-1)!
            .stockItems.find((item) => item.id === stockId)!.reservedLengthMm,
          0,
        );
        await post(`${path}/optimize`, {
          requirements,
          allocationId: allocation.id,
          expectedRevision: 999,
        }).expect(409);
        const after = await get(`${path}/${allocation.id}`).expect(200);
        assert.equal(after.body.revision, 1);
        assert.equal(after.body.items[0].stockItem.remainingLengthMm, 1000);
      },
    );

    await t.test(
      'configured rules are server-owned and saved across previews, draft submission, edits, and retries',
      async () => {
        const config = app.get<ConfigService<Environment, true>>(ConfigService);
        const original = {
          CUTTING_EDGE_TRIM_MM: config.getOrThrow('CUTTING_EDGE_TRIM_MM', {
            infer: true,
          }),
          CUTTING_MINIMUM_REMNANT_WIDTH_MM: config.getOrThrow(
            'CUTTING_MINIMUM_REMNANT_WIDTH_MM',
            { infer: true },
          ),
          CUTTING_MINIMUM_REMNANT_LENGTH_MM: config.getOrThrow(
            'CUTTING_MINIMUM_REMNANT_LENGTH_MM',
            { infer: true },
          ),
          CUTTING_DROP_ALLOWANCE_MM: config.getOrThrow(
            'CUTTING_DROP_ALLOWANCE_MM',
            { infer: true },
          ),
        };
        try {
          config.set('CUTTING_EDGE_TRIM_MM', 25.4);
          config.set('CUTTING_MINIMUM_REMNANT_WIDTH_MM', 1524);
          config.set('CUTTING_MINIMUM_REMNANT_LENGTH_MM', 1524);
          config.set('CUTTING_DROP_ALLOWANCE_MM', 254);
          const body = input(await seed());
          const { requirements } = body;
          const invalid = await post(`${path}/validate`, {
            requirements,
            plan: body.plan,
          }).expect(200);
          assert.equal(invalid.body.valid, false);
          body.plan.drops[0]!.lengthMm += 254;
          const preview = await post(`${path}/validate`, {
            requirements,
            plan: body.plan,
          }).expect(200);
          assert.equal(preview.body.valid, true);
          await post(`${path}/optimize`, { requirements }).expect(200);
          assert.equal(
            optimizedContexts.at(-1)!.requirements[0]!.lengthAllowanceMm,
            254,
          );
          assert.deepEqual(optimizedContexts.at(-1)!.settings, {
            edgeTrimMm: 25.4,
            minimumRemnantWidthMm: 1524,
            minimumRemnantLengthMm: 1524,
          });
          const key = randomUUID();
          const created = await create(body, key);
          assert.equal(created.requirements[0]!.lengthAllowanceMm, 254);
          assert.equal(created.items[0]!.reservedLengthMm, 1254);
          assert.deepEqual(created.plannedSummary, preview.body.summary);
          assert.deepEqual(created.settings, {
            edgeTrimMm: 25.4,
            minimumRemnantWidthMm: 1524,
            minimumRemnantLengthMm: 1524,
            dropAllowanceMm: 254,
          });
          const draftBody = input(body.plan.drops[0]!.stockItemId);
          draftBody.plan.drops[0]!.lengthMm += 254;
          const draftKey = randomUUID();
          const draft = (
            await post(`${path}/drafts`, { data: draftBody }, draftKey).expect(
              201,
            )
          ).body;
          config.set('CUTTING_EDGE_TRIM_MM', 400);
          config.set('CUTTING_DROP_ALLOWANCE_MM', 508);
          assert.deepEqual(await create(body, key), created);
          assert.deepEqual(
            (
              await post(
                `${path}/drafts`,
                { data: draftBody },
                draftKey,
              ).expect(201)
            ).body,
            draft,
          );
          for (const [id, data] of [
            [created.id, body],
            [draft.id, draftBody],
          ] as const) {
            const result = await post(`${path}/validate`, {
              requirements: data.requirements,
              plan: data.plan,
              allocationId: id,
              expectedRevision: 1,
            }).expect(200);
            assert.equal(result.body.valid, true);
          }
          const current = await post(`${path}/validate`, {
            requirements,
            plan: body.plan,
          }).expect(200);
          assert.equal(current.body.valid, false);
          await request(server)
            .put(`${path}/${draft.id}/draft`)
            .set('Cookie', cookie)
            .set('Origin', origin)
            .send({ expectedRevision: 1, data: draftBody })
            .expect(200);
          const submitted = (
            await post(`${path}/${draft.id}/submit`, {
              expectedRevision: 2,
            }).expect(200)
          ).body;
          assert.deepEqual(submitted.settings, created.settings);
          assert.equal(submitted.requirements[0].lengthAllowanceMm, 254);
          const replaced = (
            await put(created.id, { ...body, expectedRevision: 1 }).expect(200)
          ).body;
          assert.deepEqual(replaced.settings, created.settings);
          assert.equal(replaced.items[0].reservedLengthMm, 1254);
          for (const extra of [
            { ...body, settings: created.settings },
            { ...body, requirements: created.requirements },
          ]) {
            await post(path, extra).expect(400);
            await post(`${path}/drafts`, { data: extra }).expect(400);
          }
        } finally {
          for (const [key, value] of Object.entries(original))
            config.set(key as keyof typeof original, value);
        }
      },
    );

    await t.test(
      'creation retries are durable and competing orders cannot over-reserve a roll',
      async () => {
        const body = input(await seed());
        const key: string = randomUUID();
        const replies = await Promise.all([
          post(path, body, key),
          post(path, body, key),
        ]);
        assert.deepEqual(
          replies.map((reply) => reply.status),
          [201, 201],
        );
        assert.equal(replies[0]!.body.id, replies[1]!.body.id);
        await post(path, { ...body, orderNumber: 'DIFFERENT' }, key).expect(
          409,
        );
        const stock = await seed(1500);
        const competing = await Promise.all([
          post(path, input(stock)),
          post(path, input(stock)),
        ]);
        assert.deepEqual(
          competing.map((reply) => reply.status).sort(),
          [201, 409],
        );
        const missing = input(randomUUID());
        await post(path, missing).expect(404);
        const list = allocationListSchema.parse(
          (await get(`${path}?search=${missing.orderNumber}`).expect(200)).body,
        );
        assert.equal(list.total, 0);
      },
    );

    await t.test(
      'replacement locks both released and selected stock, checks revisions, and cancellation releases reservations',
      async () => {
        const stockId = await seed(1000);
        const body = input(stockId);
        const allocation = await create(body);
        const edited = { ...body, orderNumber: 'EDITED', expectedRevision: 1 };
        const replies = await Promise.all([
          put(allocation.id, edited),
          put(allocation.id, edited),
        ]);
        assert.deepEqual(
          replies.map((reply) => reply.status).sort(),
          [200, 409],
        );
        await post(`${path}/${allocation.id}/cancel`, {
          expectedRevision: 1,
        }).expect(409);
        const cancelled = await post(`${path}/${allocation.id}/cancel`, {
          expectedRevision: 2,
        }).expect(200);
        assert.equal(cancelled.body.state, 'cancelled');
        assert.equal(cancelled.body.revision, 3);
        await post(`${path}/${allocation.id}/cancel`, {
          expectedRevision: 2,
        }).expect(200);
        await put(allocation.id, { ...body, expectedRevision: 3 }).expect(409);
        await create(input(stockId));
        const list = allocationListSchema.parse(
          (
            await get(
              `${path}?search=EDITED&state=cancelled&pageSize=1`,
            ).expect(200)
          ).body,
        );
        assert.equal(list.items[0]!.id, allocation.id);
        assert.equal(list.items[0]!.needsReplanning, false);
      },
    );

    await t.test(
      'failed replacement preserves the old plan and reservations',
      async () => {
        const original = input(await seed(1000));
        const allocation = await create(original);
        const unavailable = await seed(1000);
        await create(input(unavailable));
        await put(allocation.id, {
          ...input(unavailable),
          expectedRevision: 1,
        }).expect(409);
        const unchanged = allocationDetailSchema.parse(
          (await get(`${path}/${allocation.id}`).expect(200)).body,
        );
        assert.equal(unchanged.revision, 1);
        assert.equal(
          unchanged.items[0]!.stockItemId,
          original.plan.drops[0]!.stockItemId,
        );
      },
    );

    await t.test(
      'completion records measurements, creates scraps once, and flags other allocations for replanning',
      async () => {
        const stockId = await seed(2000);
        const first = await create(input(stockId, 1000));
        const secondInput = input(stockId, 700);
        const second = await create(secondInput);
        const key: string = randomUUID();
        const body = {
          expectedRevision: 1,
          items: [
            {
              stockItemId: stockId,
              expectedUpdatedAt: first.items[0]!.stockItem.updatedAt,
              outcome: 'returned-roll',
              radialDepthMm: 1,
              tubeOuterDiameterMm: 50,
              locationId: ids.location,
              scraps: [
                {
                  widthMm: 100,
                  lengthMm: 100,
                  locationId: ids.location,
                  quantity: 2,
                },
              ],
            },
          ],
        };
        const before = await countStock();
        const replies = await Promise.all([
          post(`${path}/${first.id}/complete`, body, key),
          post(`${path}/${first.id}/complete`, body, key),
        ]);
        assert.deepEqual(
          replies.map((reply) => reply.status),
          [200, 200],
        );
        const completed = allocationDetailSchema.parse(replies[0]!.body);
        assert.equal(completed.state, 'completed');
        assert.equal(completed.revision, 2);
        assert.equal(completed.items[0]!.stockItem.remainingLengthMm, 320.442);
        assert.equal(completed.items[0]!.stockItem.isUsed, true);
        assert.equal(completed.items[0]!.stockItem.measurementThicknessMm, 0.5);
        assert.equal(await countStock(), before + 2);
        assert.deepEqual(
          replies[0]!.body.completion.createdStockItemIds,
          replies[1]!.body.completion.createdStockItemIds,
        );
        assert.ok(
          completed.completion!.affectedAllocationIds.includes(second.id),
        );
        for (const id of completed.completion!.createdStockItemIds) {
          const scrap = (await get(`/api/stock-items/${id}`).expect(200)).body;
          assert.equal(scrap.sourceStockItemId, stockId);
          assert.equal(scrap.isRemnant, true);
          assert.equal(scrap.tubeOuterDiameterMm, null);
        }
        assert.equal(
          (await get(`${path}/${second.id}`).expect(200)).body.needsReplanning,
          true,
        );
        const list = (
          await get(`${path}?search=${second.orderNumber}`).expect(200)
        ).body;
        assert.equal(list.items[0].needsReplanning, true);
        await post(
          `${path}/${first.id}/complete`,
          { ...body, expectedRevision: 2 },
          key,
        ).expect(409);
        await post(`${path}/${first.id}/complete`, body).expect(409);
        await put(first.id, { ...input(stockId), expectedRevision: 2 }).expect(
          409,
        );
        const replacement = {
          ...secondInput,
          plan: {
            drops: [
              { ...secondInput.plan.drops[0]!, stockItemId: await seed() },
            ],
          },
          expectedRevision: 1,
        };
        assert.equal(
          (await put(second.id, replacement).expect(200)).body.needsReplanning,
          false,
        );
      },
    );

    await t.test(
      'completion rolls back all stock writes and scraps on invalid references, then allows retry',
      async () => {
        const stockId = await seed();
        const allocation = await create(input(stockId));
        const body = {
          expectedRevision: 1,
          items: [
            {
              stockItemId: stockId,
              expectedUpdatedAt: allocation.items[0]!.stockItem.updatedAt,
              outcome: 'returned-roll',
              radialDepthMm: 1,
              tubeOuterDiameterMm: 50,
              locationId: ids.location,
              scraps: [
                {
                  widthMm: 100,
                  lengthMm: 100,
                  quantity: 1,
                  locationId: randomUUID(),
                },
              ],
            },
          ],
        };
        const before = await countStock();
        const key: string = randomUUID();
        await post(`${path}/${allocation.id}/complete`, body, key).expect(404);
        assert.equal(await countStock(), before);
        const unchanged = allocationDetailSchema.parse(
          (await get(`${path}/${allocation.id}`).expect(200)).body,
        );
        assert.equal(unchanged.state, 'active');
        assert.equal(unchanged.items[0]!.stockItem.remainingLengthMm, 10000);
        body.items[0]!.scraps[0]!.locationId = ids.location;
        await post(`${path}/${allocation.id}/complete`, body, key).expect(200);
      },
    );

    await t.test(
      'completion enforces stock revisions, tube rules, outcome coverage and retained-remnant dimensions',
      async () => {
        const stockId = await seed();
        const allocation = await create(input(stockId));
        const consumed = {
          stockItemId: stockId,
          outcome: 'consumed',
          expectedUpdatedAt: allocation.items[0]!.stockItem.updatedAt,
        };
        await post(`${path}/${allocation.id}/complete`, {
          expectedRevision: 1,
          items: [],
        }).expect(400);
        await post(`${path}/${allocation.id}/complete`, {
          expectedRevision: 1,
          items: [consumed, consumed],
        }).expect(400);
        await post(`${path}/${allocation.id}/complete`, {
          expectedRevision: 1,
          items: [consumed],
        }).expect(400);
        await post(`${path}/${allocation.id}/complete`, {
          expectedRevision: 1,
          items: [{ ...consumed, tubeOuterDiameterMm: 51 }],
        }).expect(400);
        await post(`${path}/${allocation.id}/complete`, {
          expectedRevision: 1,
          items: [
            {
              ...consumed,
              tubeOuterDiameterMm: 50,
              expectedUpdatedAt: '2000-01-01T00:00:00Z',
            },
          ],
        }).expect(409);
        const complete = await post(`${path}/${allocation.id}/complete`, {
          expectedRevision: 1,
          items: [{ ...consumed, tubeOuterDiameterMm: 50 }],
        }).expect(200);
        assert.equal(complete.body.items[0].stockItem.remainingLengthMm, 0);
        const remnantId = await seed(1000, true);
        const remnant = await create(input(remnantId, 400));
        assert.equal(remnant.items[0]!.reservedLengthMm, 1000);
        const result = await post(`${path}/${remnant.id}/complete`, {
          expectedRevision: 1,
          items: [
            {
              stockItemId: remnantId,
              expectedUpdatedAt: remnant.items[0]!.stockItem.updatedAt,
              outcome: 'returned-remnant',
              widthMm: 600,
              explicitLengthMm: 500,
              locationId: ids.location,
            },
          ],
        }).expect(200);
        assert.equal(result.body.items[0].stockItem.widthMm, 600);
        assert.equal(result.body.items[0].stockItem.remainingLengthMm, 500);
      },
    );

    await t.test(
      'a failure after writing stock leaves the allocation active and retryable',
      async () => {
        const stockId = await seed();
        const allocation = await create(input(stockId));
        const prototype = StockItemsRepository.prototype;
        const createFailure = t.mock.method(prototype, 'create', async () => {
          throw new Error('Injected failure');
        });
        const body = {
          expectedRevision: 1,
          items: [
            {
              stockItemId: stockId,
              expectedUpdatedAt: allocation.items[0]!.stockItem.updatedAt,
              outcome: 'consumed',
              tubeOuterDiameterMm: 50,
              scraps: [
                { widthMm: 100, lengthMm: 100, locationId: ids.location },
              ],
            },
          ],
        };
        try {
          await post(`${path}/${allocation.id}/complete`, body).expect(503);
        } finally {
          createFailure.mock.restore();
        }
        const unchanged = (await get(`${path}/${allocation.id}`).expect(200))
          .body;
        assert.equal(unchanged.state, 'active');
        assert.equal(unchanged.items[0].stockItem.consumedAt, null);
      },
    );
    await testAllocationDrafts(
      t,
      app,
      pool,
      schema,
      cookie,
      origin,
      seed,
      input,
    );
  } finally {
    mock.mock.restore();
    await pool.query(
      `DELETE FROM "${schema}".allocation_cut_items WHERE allocation_cut_id IN (SELECT c.id FROM "${schema}".allocation_cuts c JOIN "${schema}".allocation_items i ON i.id=c.allocation_item_id JOIN "${schema}".fabric_stock_items s ON s.id=i.stock_item_id WHERE s.fabric_color_id=$1)`,
      [ids.color],
    );
    await pool.query(
      `DELETE FROM "${schema}".allocation_cuts WHERE allocation_item_id IN (SELECT i.id FROM "${schema}".allocation_items i JOIN "${schema}".fabric_stock_items s ON s.id=i.stock_item_id WHERE s.fabric_color_id=$1)`,
      [ids.color],
    );
    await pool.query(
      `DELETE FROM "${schema}".allocation_items WHERE allocation_id IN (SELECT allocation_id FROM "${schema}".allocation_requirements WHERE fabric_color_id=$1)`,
      [ids.color],
    );
    const rows = await pool.query(
      `DELETE FROM "${schema}".allocation_requirements WHERE fabric_color_id=$1 RETURNING allocation_id`,
      [ids.color],
    );
    if (rows.rows.length)
      await pool.query(
        `DELETE FROM "${schema}".allocations WHERE id=ANY($1::uuid[])`,
        [rows.rows.map((row: { allocation_id: string }) => row.allocation_id)],
      );
    await pool.query(
      `DELETE FROM "${schema}".fabric_stock_items WHERE fabric_color_id=$1`,
      [ids.color],
    );
    await pool.query(`DELETE FROM "${schema}".locations WHERE id=$1`, [
      ids.location,
    ]);
    await pool.query(`DELETE FROM "${schema}".location_sections WHERE id=$1`, [
      ids.section,
    ]);
    await pool.query(`DELETE FROM "${schema}".location_zones WHERE id=$1`, [
      ids.zone,
    ]);
    await pool.query(`DELETE FROM "${schema}".fabric_colors WHERE id=$1`, [
      ids.color,
    ]);
    await pool.query(`DELETE FROM "${schema}".fabric_materials WHERE id=$1`, [
      ids.material,
    ]);
    await pool.query(`DELETE FROM "${schema}".manufacturers WHERE id=$1`, [
      ids.maker,
    ]);
  }
}
