import {
  stockReceiptDetailSchema,
  stockReceiptListSchema,
  stockReceiptSchema,
} from '@roller-bay/shared/stock-receipts';
import type { UserRole } from '@roller-bay/shared/users';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import 'reflect-metadata';
import request from 'supertest';
import { startSignedInApp } from '../../testing/integration-app.js';
import { StockItemsRepository } from '../stock-items/stock-items.repository.js';
import { stockCommands } from '../stock-items/testing/stock-commands.js';

test('stock receipts integration', { timeout: 60_000 }, async (t) => {
  const { app, pool, cookie, userId, origin, fixtures } =
    await startSignedInApp(t);
  const server = app.getHttpServer();
  const path = '/api/stock-receipts';
  const get = (url: string) => request(server).get(url).set('Cookie', cookie);
  const submit = (body: object, key: string = randomUUID()) =>
    request(server)
      .post(path)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', key)
      .send(body);
  const role = (value: UserRole) => fixtures.setUserRole(userId, value);
  const count = async (
    table: 'stock_receipts' | 'stock_receipt_items' | 'fabric_stock_items',
  ) =>
    (await pool.query(`SELECT count(*)::int AS total FROM "${table}"`)).rows[0]
      .total as number;
  const initialStockCount = await count('fabric_stock_items');
  const { color: colorId, location: locationId } =
    await fixtures.createColorAndLocation();
  const line = {
    fabricColorId: colorId,
    widthMm: 2000,
    initialLengthMm: 50000,
    quantity: 3,
    locationId,
  };
  const input = {
    purchaseOrderNumber: ' 12345 ',
    items: [line, { ...line, widthMm: 1000, quantity: 2 }],
  };

  await t.test(
    'stock-receipt permissions, required idempotency header, CORS, and input validation',
    async () => {
      await role('user');
      await request(server).get(path).expect(401);
      await request(server).get(`${path}/${randomUUID()}`).expect(401);
      await request(server)
        .post(path)
        .set('Origin', origin)
        .send(input)
        .expect(401);
      await request(server)
        .post(path)
        .set('Cookie', cookie)
        .send(input)
        .expect(403);
      await request(server)
        .post(path)
        .set('Cookie', cookie)
        .set('Origin', 'https://attacker.example')
        .send(input)
        .expect(403);
      await request(server)
        .post(path)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .send(input)
        .expect(400);
      await submit(input, 'bad-key').expect(400);
      await get('/api/purchase-orders').expect(404);
      await submit({ ...input, orderNumber: 'PO-LEGACY' }).expect(400);
      const preflight = await request(server)
        .options(path)
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'content-type,idempotency-key')
        .expect(204);
      assert.match(
        preflight.headers['access-control-allow-headers'] ?? '',
        /idempotency-key/i,
      );
      for (const invalid of [
        { ...input, purchaseOrderNumber: '' },
        { ...input, purchaseOrderNumber: '1234' },
        { ...input, purchaseOrderNumber: '123456' },
        { ...input, purchaseOrderNumber: 'PO-12345' },
        { ...input, items: [] },
        {
          ...input,
          items: Array.from({ length: 101 }, () => ({
            ...line,
            quantity: 1,
          })),
        },
        { ...input, items: [{ ...line, quantity: 0 }] },
        { ...input, items: [{ ...line, quantity: 1.5 }] },
        { ...input, items: [{ ...line, quantity: '3' }] },
        { ...input, items: [{ ...line, quantity: 1001 }] },
        {
          ...input,
          items: [
            { ...line, quantity: 600 },
            { ...line, quantity: 600 },
          ],
        },
        { ...input, items: [{ ...line, initialLengthMm: 0 }] },
        { ...input, items: [{ ...line, widthMm: 1.1234 }] },
        { ...input, items: [{ ...line, locationId: null }] },
        { ...input, items: [{ ...line, isUsed: true }] },
        { ...input, submittedByUserId: randomUUID() },
      ])
        await submit(invalid).expect(400);
      await fixtures.setUserActive(userId, false);
      await submit(input).expect(403);
      await get(path).expect(403);
      await get(`${path}/${randomUUID()}`).expect(403);
      await fixtures.setUserActive(userId, true);
      assert.equal(await count('stock_receipts'), 0);
    },
  );

  await t.test(
    'submission creates individual rolls and replays the original receipt after stock changes',
    async () => {
      const key = randomUUID();
      const receipt = stockReceiptSchema.parse(
        (await submit(input, key).expect(201)).body,
      );
      assert.equal(receipt.purchaseOrderNumber, '12345');
      assert.equal(receipt.submittedByUserId, userId);
      assert.equal(receipt.items.length, 2);
      assert.equal(
        receipt.items.flatMap((item) => item.stockItemIds).length,
        5,
      );
      assert.equal(await count('fabric_stock_items'), initialStockCount + 5);
      assert.ok(!('requestHash' in receipt) && !('idempotencyKey' in receipt));
      const detailResponse = await get(`${path}/${receipt.id}`).expect(200);
      assert.ok(
        !('requestHash' in detailResponse.body) &&
          !('idempotencyKey' in detailResponse.body),
      );
      const detail = stockReceiptDetailSchema.parse(detailResponse.body);
      for (const item of detail.items) {
        assert.equal(item.stockItems.length, item.quantity);
        for (const stock of item.stockItems) {
          assert.equal(stock.widthMm, item.widthMm);
          assert.equal(stock.remainingLengthMm, item.initialLengthMm);
          assert.equal(stock.locationId, locationId);
          assert.equal(stock.stockReceiptItemId, item.id);
          assert.equal(stock.isUsed, false);
          assert.equal(stock.isRemnant, false);
          assert.equal(stock.radialDepthMm, null);
          assert.equal(stock.tubeOuterDiameterMm, null);
          assert.equal(stock.measurementThicknessMm, null);
          assert.equal(stock.sourceStockItemId, null);
          assert.equal(stock.consumedAt, null);
        }
      }
      const stockId = receipt.items[0]!.stockItemIds[0]!;
      const { correct, voidStock } = stockCommands({ server, cookie, origin });
      await correct(stockId, { widthMm: 1500 }, 403);
      await role('admin');
      await voidStock(stockId, 409);
      await correct(stockId, {
        isUsed: true,
        tubeOuterDiameterMm: 50,
        radialDepthMm: 10,
      });
      await correct(stockId, { stockReceiptItemId: null }, 400);
      await role('user');
      const replay = await submit(
        { items: input.items, purchaseOrderNumber: '12345' },
        key.toUpperCase(),
      ).expect(201);
      assert.deepEqual(stockReceiptSchema.parse(replay.body), receipt);
      const changed = stockReceiptDetailSchema.parse(
        (await get(`${path}/${receipt.id}`).expect(200)).body,
      );
      assert.equal(
        changed.items
          .flatMap((item) => item.stockItems)
          .find((stock) => stock.id === stockId)!.remainingLengthMm,
        3769.911,
      );
      await submit({ ...input, purchaseOrderNumber: '54321' }, key).expect(409);
      assert.equal(await count('stock_receipts'), 1);
      assert.equal(await count('fabric_stock_items'), initialStockCount + 5);
      const page = stockReceiptListSchema.parse(
        (await get(`${path}?search=234&pageSize=1`).expect(200)).body,
      );
      assert.equal(page.total, 1);
      assert.equal(page.items[0]!.id, receipt.id);
      for (const search of ['%25', '_', '%5C'])
        assert.equal(
          (await get(`${path}?search=${search}`).expect(200)).body.total,
          0,
        );
      for (const query of ['page=0', 'pageSize=101', 'unknown=x'])
        await get(`${path}?${query}`).expect(400);
      await get(`${path}/invalid`).expect(400);
      await get(`${path}/${randomUUID()}`).expect(404);
      await request(server)
        .patch(`${path}/${receipt.id}`)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .send({})
        .expect(404);
      await request(server)
        .delete(`${path}/${receipt.id}`)
        .set('Cookie', cookie)
        .set('Origin', origin)
        .expect(404);
    },
  );

  await t.test(
    'concurrent submissions and normalized default quantities are idempotent',
    async () => {
      const key = randomUUID();
      const body = {
        purchaseOrderNumber: '20001',
        items: [{ ...line, quantity: 2 }],
      };
      const before = await count('fabric_stock_items');
      const results = await Promise.all([submit(body, key), submit(body, key)]);
      assert.deepEqual(
        results.map((result) => result.status),
        [201, 201],
      );
      assert.deepEqual(results[0]!.body, results[1]!.body);
      assert.equal(await count('fabric_stock_items'), before + 2);
      const conflictingKey = randomUUID();
      const conflicts = await Promise.all([
        submit(body, conflictingKey),
        submit({ ...body, purchaseOrderNumber: '20002' }, conflictingKey),
      ]);
      assert.deepEqual(
        conflicts.map((result) => result.status).sort(),
        [201, 409],
      );
      const defaultKey = randomUUID();
      const withoutQuantity = {
        fabricColorId: line.fabricColorId,
        widthMm: line.widthMm,
        initialLengthMm: line.initialLengthMm,
        locationId: line.locationId,
      };
      const original = await submit(
        { purchaseOrderNumber: '20003', items: [withoutQuantity] },
        defaultKey,
      ).expect(201);
      const repeated = await submit(
        {
          purchaseOrderNumber: '20003',
          items: [{ ...withoutQuantity, quantity: 1 }],
        },
        defaultKey,
      ).expect(201);
      assert.deepEqual(repeated.body, original.body);
      for (const [value, purchaseOrderNumber] of [
        ['admin', '20004'],
        ['owner', '20005'],
      ] as const) {
        await role(value);
        await submit({
          purchaseOrderNumber,
          items: [withoutQuantity],
        }).expect(201);
        await get(path).expect(200);
      }
      await role('user');
      const page1 = (await get(`${path}?pageSize=1`).expect(200)).body;
      const page2 = (await get(`${path}?pageSize=1&page=2`).expect(200)).body;
      assert.equal(page1.total, page2.total);
      assert.notEqual(page1.items[0].id, page2.items[0].id);
    },
  );

  await t.test(
    'failed references and failures after stock insertion roll back the entire receipt and permit retry',
    async () => {
      const before = [
        await count('stock_receipts'),
        await count('stock_receipt_items'),
        await count('fabric_stock_items'),
      ];
      const key = randomUUID();
      await submit(
        {
          purchaseOrderNumber: '20006',
          items: [line, { ...line, fabricColorId: randomUUID() }],
        },
        key,
      ).expect(404);
      await submit({
        purchaseOrderNumber: '20007',
        items: [{ ...line, locationId: randomUUID() }],
      }).expect(404);
      // Transaction-bound instances are constructed for each unit of work.
      const repository = StockItemsRepository.prototype;
      const insert = repository.createReceivedRolls;
      repository.createReceivedRolls = async function (...args) {
        await insert.apply(this, args);
        throw new Error('Injected failure after stock insertion');
      };
      try {
        const failed = await submit(
          { purchaseOrderNumber: '20008', items: [line] },
          key,
        ).expect(503);
        assert.ok(!JSON.stringify(failed.body).includes('Injected failure'));
      } finally {
        repository.createReceivedRolls = insert;
      }
      assert.deepEqual(
        [
          await count('stock_receipts'),
          await count('stock_receipt_items'),
          await count('fabric_stock_items'),
        ],
        before,
      );
      await submit({ purchaseOrderNumber: '20008', items: [line] }, key).expect(
        201,
      );
    },
  );
});
