import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/environment.js';
import { testAllocationDrafts } from './allocation-drafts.integration-cases.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import request from 'supertest';
import { startSignedInApp } from '../../testing/integration-app.js';
import { historySchema } from '@roller-bay/shared/audit';
import {
  allocationDetailSchema,
  allocationListSchema,
  type CreateAllocation,
  type CuttingContext,
} from '@roller-bay/shared/allocations';
import { StockItemsRepository } from '../stock-items/stock-items.repository.js';
import { CuttingPlanOptimizer } from './optimizer/cutting-plan-optimizer.js';
import { validateCuttingPlan } from './cutting-plan/cutting-plan.validator.js';

test('allocations integration', { timeout: 60_000 }, async (t) => {
  const { app, pool, cookie, userId, origin } = await startSignedInApp(t);
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
      `INSERT INTO fabric_stock_items (id, fabric_color_id, width_mm, initial_length_mm, explicit_length_mm, location_id, is_remnant, is_used)
      VALUES ($1, $2, 1200, $3, $4, $5, $6, $6)`,
      [id, ids.color, length, remnant ? length : null, ids.location, remnant],
    );
    return id;
  };
  // Sequential numbers keep order-number searches unambiguous.
  let orderNumber = 100000;
  const input = (stockId: string, length = 1000): CreateAllocation => {
    const requirementId = randomUUID();
    return {
      orderNumber: String(++orderNumber),
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
          { stockItemId: stockId, items: [{ requirementId, quantity: 1 }] },
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
          `SELECT count(*) AS total FROM fabric_stock_items WHERE fabric_color_id=$1`,
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
    },
  );
  try {
    await pool.query(
      `INSERT INTO manufacturers (id,name) VALUES ($1,'Allocation manufacturer')`,
      [ids.maker],
    );
    await pool.query(
      `INSERT INTO fabric_materials (id,manufacturer_id,name) VALUES ($1,$2,'Allocation material')`,
      [ids.material, ids.maker],
    );
    await pool.query(
      `INSERT INTO fabric_colors (id,material_id,code,thickness_mm) VALUES ($1,$2,'ALLOC-TEST',0.5)`,
      [ids.color, ids.material],
    );
    await pool.query(
      `INSERT INTO location_zones (id,name) VALUES ($1,'Allocation warehouse')`,
      [ids.zone],
    );
    await pool.query(
      `INSERT INTO location_sections (id,zone_id,label) VALUES ($1,$2,'A')`,
      [ids.section, ids.zone],
    );
    await pool.query(
      `INSERT INTO locations (id,section_id,label) VALUES ($1,$2,'1')`,
      [ids.location, ids.section],
    );
    // Allocations must name a scheduled order and match its quantity; every
    // allocation here plans one blind.
    await pool.query(
      `INSERT INTO scheduled_orders (order_number, ship_date, quantity)
       SELECT n::text, '2026-10-01', 1 FROM generate_series(100001, 100400) n
       UNION ALL VALUES ('999998', '2026-10-01'::date, 1), ('999999', '2026-10-01', 1)`,
    );
    await pool.query(
      `UPDATE users SET role='user', is_active=true WHERE id=$1`,
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
          .post(`/api/stock-items/${result.items[0]!.stockItemId}/corrections`)
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
          // Cut length is derived from the drop and allowance, never supplied.
          await post(`${path}/validate`, {
            requirements,
            plan: { cuts: [{ ...body.plan.cuts[0], lengthMm: 1254 }] },
          }).expect(400);
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
          assert.equal(created.plan.cuts[0]!.lengthMm, 1254);
          assert.equal(created.items[0]!.reservedLengthMm, 1254);
          assert.deepEqual(created.plannedSummary, preview.body.summary);
          assert.deepEqual(created.settings, {
            edgeTrimMm: 25.4,
            minimumRemnantWidthMm: 1524,
            minimumRemnantLengthMm: 1524,
            dropAllowanceMm: 254,
          });
          const draftBody = input(body.plan.cuts[0]!.stockItemId);
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
        await post(path, { ...body, orderNumber: '999999' }, key).expect(409);
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
        const edited = { ...body, orderNumber: '999998', expectedRevision: 1 };
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
              `${path}?search=999998&state=cancelled&pageSize=1`,
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
          original.plan.cuts[0]!.stockItemId,
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
              expectedRevision: first.items[0]!.stockItem.revision,
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
            cuts: [{ ...secondInput.plan.cuts[0]!, stockItemId: await seed() }],
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
              expectedRevision: allocation.items[0]!.stockItem.revision,
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
          expectedRevision: allocation.items[0]!.stockItem.revision,
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
          items: [{ ...consumed, tubeOuterDiameterMm: 50.0005 }],
        }).expect(400);
        await post(`${path}/${allocation.id}/complete`, {
          expectedRevision: 1,
          items: [
            {
              ...consumed,
              tubeOuterDiameterMm: 50,
              expectedRevision: 999,
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
              expectedRevision: remnant.items[0]!.stockItem.revision,
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
              expectedRevision: allocation.items[0]!.stockItem.revision,
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
    await t.test(
      'allocations name a scheduled order, and an order has one live allocation',
      async () => {
        const unscheduled = { ...input(await seed()), orderNumber: '888888' };
        const issue = (body: { issues?: { code: string; path: unknown }[] }) =>
          body.issues?.map(({ code, path }) => ({ code, path }));
        const missing = [
          { code: 'order_not_scheduled', path: ['orderNumber'] },
        ];
        assert.deepEqual(
          issue((await post(path, unscheduled).expect(404)).body),
          missing,
        );
        assert.deepEqual(
          issue(
            (
              await post(`${path}/drafts`, {
                data: { orderNumber: '888888' },
              }).expect(404)
            ).body,
          ),
          missing,
        );
        // Partial order numbers are no longer saved on drafts.
        await post(`${path}/drafts`, { data: { orderNumber: '8888' } }).expect(
          400,
        );

        const first = await create(input(await seed()));
        const again = {
          ...input(await seed()),
          orderNumber: first.orderNumber,
        };
        const taken = [
          { code: 'order_already_allocated', path: ['orderNumber'] },
        ];
        assert.deepEqual(
          issue((await post(path, again).expect(409)).body),
          taken,
        );
        const other = await create(input(await seed()));
        assert.deepEqual(
          issue(
            (
              await put(other.id, {
                ...again,
                expectedRevision: other.revision,
              }).expect(409)
            ).body,
          ),
          taken,
        );
        await put(other.id, {
          ...unscheduled,
          expectedRevision: other.revision,
        }).expect(404);

        // An allocation's blinds add up to its order's quantity, when it is
        // confirmed and again when it is replanned.
        const counted = input(await seed());
        const setQuantity = (quantity: number) =>
          pool.query(
            `UPDATE scheduled_orders SET quantity=$1 WHERE order_number=$2`,
            [quantity, counted.orderNumber],
          );
        await setQuantity(3);
        const short = await post(path, counted).expect(400);
        assert.deepEqual(issue(short.body), [
          { code: 'order_quantity_mismatch', path: ['orderNumber'] },
        ]);
        assert.equal(
          short.body.message,
          'The order has 3 blinds but the allocation has 1.',
        );
        // The refused allocation claimed nothing.
        assert.equal(
          (
            await pool.query(
              `SELECT allocated_at FROM scheduled_orders WHERE order_number=$1`,
              [counted.orderNumber],
            )
          ).rows[0].allocated_at,
          null,
        );
        await setQuantity(1);
        const matched = await create(counted);
        await setQuantity(2);
        assert.deepEqual(
          issue(
            (
              await put(matched.id, {
                ...counted,
                expectedRevision: matched.revision,
              }).expect(400)
            ).body,
          ),
          [{ code: 'order_quantity_mismatch', path: ['orderNumber'] }],
        );
        await setQuantity(1);

        // Drafts claim nothing, so they may share the order's number.
        const drafts = [];
        for (let count = 0; count < 2; count++)
          drafts.push(
            (
              await post(`${path}/drafts`, {
                data: { orderNumber: first.orderNumber },
              }).expect(201)
            ).body,
          );
        for (const draft of drafts)
          await request(server)
            .delete(`${path}/${draft.id}/draft`)
            .set('Cookie', cookie)
            .set('Origin', origin)
            .send({ expectedRevision: 1 })
            .expect(204);

        // A cancelled allocation frees its order; a completed one does not.
        await post(`${path}/${first.id}/cancel`, {
          expectedRevision: first.revision,
        }).expect(200);
        await create(again);

        const order = (
          await pool.query(
            `SELECT id, revision FROM scheduled_orders WHERE order_number=$1`,
            [first.orderNumber],
          )
        ).rows[0];
        await pool.query(`UPDATE users SET role='admin' WHERE id=$1`, [userId]);
        try {
          await request(server)
            .delete(`/api/order-schedule/${order.id}`)
            .set('Cookie', cookie)
            .set('Origin', origin)
            .send({ expectedRevision: order.revision })
            .expect(409);
          // Its quantity is fixed while an allocation was checked against it;
          // other fields still change.
          const edit = (body: object) =>
            request(server)
              .patch(`/api/order-schedule/${order.id}`)
              .set('Cookie', cookie)
              .set('Origin', origin)
              .send({ expectedRevision: order.revision, ...body });
          const fixed = await edit({ quantity: 5 }).expect(409);
          assert.deepEqual(issue(fixed.body), [
            { code: 'order_allocated', path: ['quantity'] },
          ]);
          await edit({ quantity: 1, note: 'Same quantity' }).expect(200);
        } finally {
          await pool.query(`UPDATE users SET role='user' WHERE id=$1`, [
            userId,
          ]);
        }
      },
    );
    await t.test(
      'an order can be deleted once its allocation is cancelled, and is then off the schedule',
      async () => {
        const body = input(await seed());
        const allocation = await create(body);
        const draft = (
          await post(`${path}/drafts`, {
            data: { orderNumber: body.orderNumber },
          }).expect(201)
        ).body;
        const order = (
          await pool.query(
            `SELECT id FROM scheduled_orders WHERE order_number=$1`,
            [body.orderNumber],
          )
        ).rows[0];
        const asAdmin = async <T>(work: () => Promise<T>) => {
          await pool.query(`UPDATE users SET role='admin' WHERE id=$1`, [
            userId,
          ]);
          try {
            return await work();
          } finally {
            await pool.query(`UPDATE users SET role='user' WHERE id=$1`, [
              userId,
            ]);
          }
        };
        const schedule = (method: 'delete' | 'post', url: string) => {
          const agent = request(server);
          return (method === 'post' ? agent.post(url) : agent.delete(url))
            .set('Cookie', cookie)
            .set('Origin', origin);
        };
        const remove = () =>
          asAdmin(() =>
            schedule('delete', `/api/order-schedule/${order.id}`).send({
              // Milestone stamps leave the order's revision alone.
              expectedRevision: 1,
            }),
          );

        const refused = await remove();
        assert.equal(refused.status, 409);
        assert.equal(
          refused.body.message,
          'This order has an allocation. Cancel it before deleting the order.',
        );
        await post(`${path}/${allocation.id}/cancel`, {
          expectedRevision: allocation.revision,
        }).expect(200);
        // Neither the cancelled allocation nor the draft holds the order now.
        assert.equal((await remove()).status, 204);

        // A deleted order is not on the schedule for new work or drafts.
        const missing = [
          { code: 'order_not_scheduled', path: ['orderNumber'] },
        ];
        const issue = (reply: {
          body: { issues?: { code: string; path: unknown }[] };
        }) => reply.body.issues?.map(({ code, path }) => ({ code, path }));
        const again = { ...input(await seed()), orderNumber: body.orderNumber };
        assert.deepEqual(issue(await post(path, again).expect(404)), missing);
        assert.deepEqual(
          issue(
            await post(`${path}/drafts`, {
              data: { orderNumber: body.orderNumber },
            }).expect(404),
          ),
          missing,
        );
        assert.deepEqual(
          issue(
            await request(server)
              .put(`${path}/${draft.id}/draft`)
              .set('Cookie', cookie)
              .set('Origin', origin)
              .send({
                expectedRevision: 1,
                data: { orderNumber: body.orderNumber },
              })
              .expect(404),
          ),
          missing,
        );
        // The cancelled allocation still reads as it was.
        assert.equal(
          (await get(`${path}/${allocation.id}`).expect(200)).body.orderNumber,
          body.orderNumber,
        );

        // Scheduling the number again restores the order, here with a new
        // quantity: two blinds where the cancelled allocation planned one.
        const restored = await asAdmin(() =>
          schedule('post', '/api/order-schedule').send({
            orderNumber: body.orderNumber,
            shipDate: '2026-10-01',
            quantity: 2,
          }),
        );
        assert.equal(restored.status, 201);
        assert.equal(restored.body.id, order.id);
        assert.equal(restored.body.quantity, 2);
        // The cancelled allocation is history; nothing re-checks it.
        const cancelled = allocationDetailSchema.parse(
          (await get(`${path}/${allocation.id}`).expect(200)).body,
        );
        assert.equal(cancelled.state, 'cancelled');
        assert.equal(cancelled.requirements[0]!.quantity, 1);

        // New work answers to the new quantity, on a direct create and when a
        // draft is submitted; saving the draft is not checked.
        const mismatch = [
          { code: 'order_quantity_mismatch', path: ['orderNumber'] },
        ];
        const short = await post(path, again).expect(400);
        assert.deepEqual(issue(short), mismatch);
        assert.equal(
          short.body.message,
          'The order has 2 blinds but the allocation has 1.',
        );
        const planned = (
          await post(`${path}/drafts`, { data: again }).expect(201)
        ).body;
        assert.deepEqual(
          issue(
            await post(`${path}/${planned.id}/submit`, {
              expectedRevision: 1,
            }).expect(400),
          ),
          mismatch,
        );
        // The refused submission left the draft a draft and the order free.
        assert.equal(
          (await get(`${path}/${planned.id}`).expect(200)).body.state,
          'draft',
        );
        const two = {
          ...again,
          requirements: [{ ...again.requirements[0]!, quantity: 2 }],
          plan: { cuts: [again.plan.cuts[0]!, again.plan.cuts[0]!] },
        };
        await request(server)
          .put(`${path}/${planned.id}/draft`)
          .set('Cookie', cookie)
          .set('Origin', origin)
          .send({ expectedRevision: 1, data: two })
          .expect(200);
        const confirmed = allocationDetailSchema.parse(
          (
            await post(`${path}/${planned.id}/submit`, {
              expectedRevision: 2,
            }).expect(200)
          ).body,
        );
        assert.equal(confirmed.state, 'active');
        assert.ok(
          (
            await pool.query(
              `SELECT allocated_at FROM scheduled_orders WHERE id=$1`,
              [order.id],
            )
          ).rows[0].allocated_at,
        );
        await request(server)
          .delete(`${path}/${draft.id}/draft`)
          .set('Cookie', cookie)
          .set('Origin', origin)
          .send({ expectedRevision: 1 })
          .expect(204);
      },
    );
    await t.test(
      'confirming, moving, cancelling, and completing an allocation stamp its scheduled order',
      async () => {
        const order = async (orderNumber: string) =>
          (
            await pool.query(
              `SELECT * FROM scheduled_orders WHERE order_number=$1`,
              [orderNumber],
            )
          ).rows[0];
        const allocationRow = async (id: string) =>
          (
            await pool.query(
              `SELECT confirmed_at, completed_at FROM allocations WHERE id=$1`,
              [id],
            )
          ).rows[0];
        const stockId = await seed();
        const body = input(stockId);
        const allocation = await create(body);
        const confirmedAt = (await allocationRow(allocation.id)).confirmed_at;
        let row = await order(body.orderNumber);
        assert.deepEqual(row.allocated_at, confirmedAt);
        assert.equal(row.cut_at, null);
        // Stamps leave the revision alone so an open admin edit stays current.
        assert.equal(row.revision, 1);

        // Both requests hold the foreign key's share lock on the order; the
        // loser must wait and see the stamp rather than deadlock.
        const contested = input(await seed()).orderNumber;
        const racers = await Promise.all(
          [await seed(), await seed()].map((stock) =>
            post(path, { ...input(stock), orderNumber: contested }),
          ),
        );
        assert.deepEqual(
          racers.map((reply) => reply.status).sort(),
          [201, 409],
        );
        assert.equal(
          racers.find((reply) => reply.status === 409)!.body.issues[0].code,
          'order_already_allocated',
        );

        // Replacing onto another order moves the milestone, keeping its time.
        const target = input(stockId).orderNumber;
        const moved = allocationDetailSchema.parse(
          (
            await put(allocation.id, {
              ...body,
              orderNumber: target,
              expectedRevision: allocation.revision,
            }).expect(200)
          ).body,
        );
        assert.equal((await order(body.orderNumber)).allocated_at, null);
        assert.deepEqual((await order(target)).allocated_at, confirmedAt);

        const shipped = input(stockId).orderNumber;
        await pool.query(
          `UPDATE scheduled_orders SET shipped_at=now() WHERE order_number=$1`,
          [shipped],
        );
        const late = await post(path, {
          ...input(await seed()),
          orderNumber: shipped,
        }).expect(409);
        assert.equal(late.body.issues[0].code, 'order_shipped');

        // Cancelling returns the order to scheduled, free to allocate again.
        await post(`${path}/${moved.id}/cancel`, {
          expectedRevision: moved.revision,
        }).expect(200);
        assert.equal((await order(target)).allocated_at, null);
        await post(`${path}/${moved.id}/cancel`, {
          expectedRevision: moved.revision,
        }).expect(200);
        const again = await create({ ...input(stockId), orderNumber: target });

        const completion = {
          expectedRevision: again.revision,
          items: [
            {
              stockItemId: stockId,
              expectedRevision: again.items[0]!.stockItem.revision,
              outcome: 'consumed',
              tubeOuterDiameterMm: 50,
            },
          ],
        };
        const key = randomUUID();
        await post(`${path}/${again.id}/complete`, completion, key).expect(200);
        await post(`${path}/${again.id}/complete`, completion, key).expect(200);
        const stamps = await allocationRow(again.id);
        row = await order(target);
        assert.deepEqual(row.allocated_at, stamps.confirmed_at);
        assert.deepEqual(row.cut_at, stamps.completed_at);
        assert.equal(row.revision, 1);
        assert.equal(
          (await get(`/api/order-schedule/${row.id}`).expect(200)).body.status,
          'cut',
        );

        // Each allocation event carries the order's change, so the order's
        // own history explains its milestones.
        const history = historySchema.parse(
          (await get(`/api/order-schedule/${row.id}/history`).expect(200)).body,
        );
        assert.deepEqual(history.items.map((event) => event.action).sort(), [
          'allocation.cancelled',
          'allocation.completed',
          'allocation.confirmed',
          'allocation.replaced',
        ]);
        const completedEvent = history.items.find(
          (event) => event.action === 'allocation.completed',
        )!;
        assert.deepEqual(
          completedEvent.changes.map((c) => c.recordType).slice(0, 2),
          ['allocations', 'order-schedule'],
        );
      },
    );
    await testAllocationDrafts(t, app, pool, cookie, origin, seed, input);
  } finally {
    mock.mock.restore();
    await pool.query(
      `DELETE FROM allocation_cut_items WHERE allocation_cut_id IN (SELECT c.id FROM allocation_cuts c JOIN allocation_items i ON i.id=c.allocation_item_id JOIN fabric_stock_items s ON s.id=i.stock_item_id WHERE s.fabric_color_id=$1)`,
      [ids.color],
    );
    await pool.query(
      `DELETE FROM allocation_cuts WHERE allocation_item_id IN (SELECT i.id FROM allocation_items i JOIN fabric_stock_items s ON s.id=i.stock_item_id WHERE s.fabric_color_id=$1)`,
      [ids.color],
    );
    await pool.query(
      `DELETE FROM allocation_items WHERE allocation_id IN (SELECT allocation_id FROM allocation_requirements WHERE fabric_color_id=$1)`,
      [ids.color],
    );
    const rows = await pool.query(
      `DELETE FROM allocation_requirements WHERE fabric_color_id=$1 RETURNING allocation_id`,
      [ids.color],
    );
    if (rows.rows.length)
      await pool.query(`DELETE FROM allocations WHERE id=ANY($1::uuid[])`, [
        rows.rows.map((row: { allocation_id: string }) => row.allocation_id),
      ]);
    await pool.query(`DELETE FROM scheduled_orders`);
    await pool.query(
      `DELETE FROM fabric_stock_items WHERE fabric_color_id=$1`,
      [ids.color],
    );
    await pool.query(`DELETE FROM locations WHERE id=$1`, [ids.location]);
    await pool.query(`DELETE FROM location_sections WHERE id=$1`, [
      ids.section,
    ]);
    await pool.query(`DELETE FROM location_zones WHERE id=$1`, [ids.zone]);
    await pool.query(`DELETE FROM fabric_colors WHERE id=$1`, [ids.color]);
    await pool.query(`DELETE FROM fabric_materials WHERE id=$1`, [
      ids.material,
    ]);
    await pool.query(`DELETE FROM manufacturers WHERE id=$1`, [ids.maker]);
  }
});
