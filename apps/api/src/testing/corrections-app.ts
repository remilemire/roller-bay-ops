import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import { allocationDetailSchema } from '@roller-bay/shared/allocations';
import {
  completionCorrectionContextSchema,
  receiptCorrectionContextSchema,
} from '@roller-bay/shared/corrections';
import { stockItemSchema } from '@roller-bay/shared/stock-items';
import { stockReceiptDetailSchema } from '@roller-bay/shared/stock-receipts';
import type { UserRole } from '@roller-bay/shared/users';
import request from 'supertest';
import { startSignedInApp } from './integration-app.js';

/**
 * The signed-in app, as an admin, with what every corrections suite builds
 * on: two colors, a location, scheduled orders, and helpers that receive
 * stock, allocate it and complete the allocation through the API, because
 * corrections work from the effects those workflows recorded.
 */
export async function startCorrectionsApp(t: TestContext) {
  const harness = await startSignedInApp(t);
  const { app, cookie, userId, origin, fixtures } = harness;
  const server = app.getHttpServer();
  const get = (path: string) =>
    request(server)
      .get('/api' + path)
      .set('Cookie', cookie);
  const post = (path: string, body: object, key = randomUUID()) =>
    request(server)
      .post('/api' + path)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', key)
      .send(body);
  const role = (value: UserRole) => fixtures.setUserRole(userId, value);
  const suffix = randomUUID().slice(0, 5);
  await role('admin');
  const maker = (
    await post('/fabric-catalog/manufacturers', {
      name: 'Corrections ' + suffix,
    }).expect(201)
  ).body;
  const material = (
    await post('/fabric-catalog/materials', {
      name: 'Corrections',
      manufacturerId: maker.id,
    }).expect(201)
  ).body;
  const color = (
    await post('/fabric-catalog/colors', {
      code: 'COR-' + suffix,
      materialId: material.id,
      thicknessMm: 0.5,
    }).expect(201)
  ).body;
  const otherColor = (
    await post('/fabric-catalog/colors', {
      code: 'COR2-' + suffix,
      materialId: material.id,
      thicknessMm: 0.3,
    }).expect(201)
  ).body;
  const zone = (
    await post('/locations/zones', { name: 'Corrections ' + suffix }).expect(
      201,
    )
  ).body;
  const section = (
    await post('/locations/sections', { zoneId: zone.id, label: 'A' }).expect(
      201,
    )
  ).body;
  const location = (
    await post('/locations', { sectionId: section.id, label: '1' }).expect(201)
  ).body;
  const line = {
    fabricColorId: color.id,
    widthMm: 2000,
    initialLengthMm: 10000,
    quantity: 2,
    locationId: location.id,
  };
  const receipt = async (quantity = 2) =>
    stockReceiptDetailSchema.parse(
      (
        await post('/stock-receipts', {
          purchaseOrderNumber: '30001',
          items: [{ ...line, quantity }],
        }).expect(201)
      ).body,
    );
  const readStock = async (id: string) =>
    stockItemSchema.parse((await get(`/stock-items/${id}`).expect(200)).body);
  const receiptContext = async (id: string) =>
    receiptCorrectionContextSchema.parse(
      (await get(`/stock-receipts/${id}/correction-context`).expect(200)).body,
    );
  const completionContext = async (id: string) =>
    completionCorrectionContextSchema.parse(
      (await get(`/allocations/${id}/correction-context`).expect(200)).body,
    );
  const versions = (context: {
    eligibility: { stockItemId: string; revision: number }[];
  }) =>
    context.eligibility.map((e) => ({
      stockItemId: e.stockItemId,
      expectedRevision: e.revision,
    }));
  // Each allocation plans the one blind of a work order of its own.
  let orderNumber = 300000;
  const plan = async (stockId: string, quantity = 1) => {
    const order = await fixtures.createWorkOrder(
      String(++orderNumber),
      quantity,
    );
    const requirementId = randomUUID();
    return {
      workOrderId: order.id,
      requirements: [
        {
          id: requirementId,
          fabricColorId: color.id,
          widthMm: 500,
          lengthMm: 1000,
          quantity,
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
  const allocate = async (stockId: string) =>
    allocationDetailSchema.parse(
      (await post('/allocations', await plan(stockId)).expect(201)).body,
    );
  const complete = async (allocation: Awaited<ReturnType<typeof allocate>>) => {
    const stock = allocation.items[0]!.stockItem;
    const input = {
      expectedRevision: allocation.revision,
      items: [
        {
          stockItemId: stock.id,
          expectedRevision: stock.revision,
          outcome: 'returned-roll',
          tubeOuterDiameterMm: 50,
          radialDepthMm: 10,
          locationId: location.id,
          scraps: [
            {
              widthMm: 300,
              lengthMm: 500,
              locationId: location.id,
              quantity: 2,
            },
          ],
        },
      ],
    };
    const key = randomUUID();
    return {
      record: allocationDetailSchema.parse(
        (
          await post(
            `/allocations/${allocation.id}/complete`,
            input,
            key,
          ).expect(200)
        ).body,
      ),
      input,
      key,
    };
  };
  return {
    ...harness,
    server,
    get,
    post,
    role,
    color,
    otherColor,
    location,
    line,
    receipt,
    readStock,
    receiptContext,
    completionContext,
    versions,
    plan,
    allocate,
    complete,
  };
}
