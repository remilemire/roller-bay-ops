import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import type { TestContext } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'pg';
import request from 'supertest';
import {
  receiptCorrectionContextSchema,
  completionCorrectionContextSchema,
  correctionResultSchema,
} from '@roller-bay/shared/corrections';
import { stockItemSchema } from '@roller-bay/shared/stock-items';
import { stockReceiptDetailSchema } from '@roller-bay/shared/stock-receipts';
import {
  allocationDetailSchema,
  completeAllocationRequestSchema,
} from '@roller-bay/shared/allocations';
import { historySchema } from '@roller-bay/shared/audit';
import { AuditRepository } from './audit.repository.js';

export async function testCorrections(
  t: TestContext,
  app: INestApplication,
  pool: Pool,
  schema: string,
  cookie: string,
  userId: string,
  origin: string,
) {
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
  const role = (value: string) =>
    pool.query(`UPDATE "${schema}".users SET role=$1 WHERE id=$2`, [
      value,
      userId,
    ]);
  const suffix = randomUUID().slice(0, 5);
  await role('admin');
  try {
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
      await post('/locations', { sectionId: section.id, label: '1' }).expect(
        201,
      )
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
        (await get(`/stock-receipts/${id}/correction-context`).expect(200))
          .body,
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
    const plan = (stockId: string) => {
      const requirementId = randomUUID();
      return {
        orderNumber: '300001',
        requirements: [
          {
            id: requirementId,
            fabricColorId: color.id,
            widthMm: 500,
            lengthMm: 1000,
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
    const allocate = async (stockId: string) =>
      allocationDetailSchema.parse(
        (await post('/allocations', plan(stockId)).expect(201)).body,
      );
    const complete = async (
      allocation: Awaited<ReturnType<typeof allocate>>,
    ) => {
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
    await t.test(
      'employees can read history but only admins correct; no unaudited stock write routes remain',
      async () => {
        const r = await receipt(1),
          s = r.items[0]!.stockItems[0]!;
        await role('user');
        const history = historySchema.parse(
          (await get(`/stock-items/${s.id}/history`).expect(200)).body,
        );
        assert.equal(history.items[0]!.actorId, userId);
        assert.equal(history.items[0]!.action, 'receipt.submitted');
        await post(`/stock-items/${s.id}/corrections`, {
          reason: 'Count',
          expectedRevision: 1,
          changes: { widthMm: 1800 },
        }).expect(403);
        await post(`/stock-receipts/${r.id}/corrections`, {}).expect(403);
        await get(`/stock-receipts/${r.id}/correction-context`).expect(403);
        await role('admin');
        await request(server)
          .patch(`/api/stock-items/${s.id}`)
          .set('Cookie', cookie)
          .set('Origin', origin)
          .send({ widthMm: 1800 })
          .expect(404);
        await request(server)
          .delete(`/api/stock-items/${s.id}`)
          .set('Cookie', cookie)
          .set('Origin', origin)
          .expect(404);
        await post(`/stock-items/${s.id}/corrections`, {
          reason: ' ',
          expectedRevision: 1,
          changes: { widthMm: 1800 },
        }).expect(400);
        await post(`/stock-items/${s.id}/void`, {
          reason: 'Duplicate',
          expectedRevision: 1,
        }).expect(409);
      },
    );
    await t.test(
      'receipt quantity corrections preserve identities, original submission and immutable history across retries',
      async () => {
        const r = await receipt(3),
          context = await receiptContext(r.id),
          lineId = r.items[0]!.id;
        const removed = r.items[0]!.stockItemIds[0]!;
        const originalHistory = (
          await get(`/stock-receipts/${r.id}/history`).expect(200)
        ).body;
        const body = {
          reason: 'Only two rolls arrived',
          expectedRevision: r.revision,
          operations: [
            {
              action: 'update',
              lineId,
              data: line,
              removeStockItemIds: [removed],
            },
          ],
          stockVersions: versions(context),
        };
        const key = randomUUID();
        const responses = await Promise.all([
          post(`/stock-receipts/${r.id}/corrections`, body, key),
          post(`/stock-receipts/${r.id}/corrections`, body, key),
        ]);
        assert.deepEqual(
          responses.map((r) => r.status),
          [200, 200],
        );
        assert.deepEqual(responses[0]!.body, responses[1]!.body);
        correctionResultSchema.parse(responses[0]!.body);
        await post(
          `/stock-receipts/${r.id}/corrections`,
          { ...body, reason: 'Changed' },
          key,
        ).expect(409);
        const corrected = stockReceiptDetailSchema.parse(
          (await get(`/stock-receipts/${r.id}`).expect(200)).body,
        );
        assert.equal(corrected.submittedAt, r.submittedAt);
        assert.equal(corrected.submittedByUserId, r.submittedByUserId);
        assert.equal(corrected.items[0]!.id, lineId);
        assert.deepEqual(
          corrected.items[0]!.stockItemIds,
          r.items[0]!.stockItemIds,
        );
        const voided = await readStock(removed);
        assert.ok(voided.voidedAt);
        assert.equal(voided.consumedAt, null);
        assert.equal(voided.remainingLengthMm, 0);
        assert.ok(
          !(await get('/stock-items').expect(200)).body.items.some(
            (i: { id: string }) => i.id === removed,
          ),
        );
        assert.ok(
          (await get('/stock-items?isVoided=true').expect(200)).body.items.some(
            (i: { id: string }) => i.id === removed,
          ),
        );
        const history = historySchema.parse(
          (await get(`/stock-receipts/${r.id}/history`).expect(200)).body,
        );
        assert.equal(history.total, 2);
        assert.deepEqual(
          history.items.find((e) => e.id === originalHistory.items[0].id),
          originalHistory.items[0],
        );
        const next = await receiptContext(r.id);
        const added = correctionResultSchema.parse(
          (
            await post(`/stock-receipts/${r.id}/corrections`, {
              ...body,
              expectedRevision: next.record.revision,
              operations: [
                {
                  action: 'update',
                  lineId,
                  data: { ...line, quantity: 4 },
                  removeStockItemIds: [],
                },
              ],
              stockVersions: versions(next),
            }).expect(200)
          ).body,
        );
        assert.equal(added.createdStockItemIds.length, 2);
        await post(`/stock-receipts/${r.id}/corrections`, body, key).expect(
          200,
        );
      },
    );
    await t.test(
      'receipt lines with later activity block independently; unused lines can change fabric and dimensions',
      async () => {
        const r = stockReceiptDetailSchema.parse(
          (
            await post('/stock-receipts', {
              purchaseOrderNumber: '30002',
              items: [line, line],
            }).expect(201)
          ).body,
        );
        const first = r.items[0]!,
          second = r.items[1]!;
        const allocation = await allocate(first.stockItemIds[0]!);
        const context = await receiptContext(r.id);
        const body = {
          reason: 'Wrong fabric on second line',
          expectedRevision: r.revision,
          stockVersions: versions(context),
          operations: [
            {
              action: 'update',
              lineId: second.id,
              data: {
                ...line,
                fabricColorId: otherColor.id,
                widthMm: 1800,
                initialLengthMm: 8000,
              },
            },
          ],
        };
        await post(`/stock-receipts/${r.id}/corrections`, body).expect(200);
        assert.equal(
          (await readStock(second.stockItemIds[0]!)).fabricColorId,
          otherColor.id,
        );
        const next = await receiptContext(r.id);
        await post(`/stock-receipts/${r.id}/corrections`, {
          ...body,
          expectedRevision: next.record.revision,
          stockVersions: versions(next),
          operations: [{ action: 'remove', lineId: first.id }],
        }).expect(409);
        await post(`/allocations/${allocation.id}/cancel`, {
          expectedRevision: allocation.revision,
        }).expect(200);
        const s = await readStock(first.stockItemIds[0]!);
        await post(`/stock-items/${s.id}/corrections`, {
          reason: 'Current stock adjustment',
          expectedRevision: s.revision,
          changes: { widthMm: 1900 },
        }).expect(200);
        assert.ok(
          (await receiptContext(r.id)).eligibility
            .find((e) => e.stockItemId === s.id)!
            .blockers.some((b) => b.code === 'changed'),
        );
      },
    );
    await t.test(
      'legacy receipt stock stays untouched while paperwork references remain correctable',
      async () => {
        const r = await receipt(1);
        await pool.query(
          `UPDATE "${schema}".stock_receipts SET stock_effects=NULL WHERE id=$1`,
          [r.id],
        );
        const c = await receiptContext(r.id);
        assert.equal(c.baselineAvailable, false);
        await post(`/stock-receipts/${r.id}/corrections`, {
          reason: 'Paperwork typo',
          expectedRevision: r.revision,
          purchaseOrderNumber: '30003',
        }).expect(200);
        await post(`/stock-receipts/${r.id}/corrections`, {
          reason: 'Old stock correction',
          expectedRevision: r.revision + 1,
          operations: [{ action: 'remove', lineId: r.items[0]!.id }],
        }).expect(409);
        assert.equal(
          (await readStock(r.items[0]!.stockItemIds[0]!)).revision,
          1,
        );
      },
    );
    await t.test(
      'completion corrections retain original thickness, history, remnant IDs and original retry identity',
      async () => {
        const r = await receipt(1);
        const {
          record,
          input: originalInput,
          key: originalKey,
        } = await complete(await allocate(r.items[0]!.stockItemIds[0]!));
        const c = await completionContext(record.id);
        const source = record.items[0]!.stockItemId;
        const pieces = c.effects.filter((e) => !e.before);
        await request(server)
          .patch(`/api/fabric-catalog/colors/${color.id}`)
          .set('Cookie', cookie)
          .set('Origin', origin)
          .send({ thicknessMm: 0.25 })
          .expect(200);
        const body = {
          reason: 'Correct depth and retained pieces',
          expectedRevision: record.revision,
          stockVersions: versions(c),
          items: [
            {
              outcome: {
                stockItemId: source,
                expectedRevision: c.eligibility.find(
                  (e) => e.stockItemId === source,
                )!.revision,
                outcome: 'returned-roll',
                radialDepthMm: 12,
                tubeOuterDiameterMm: 50,
                locationId: location.id,
                scraps: [],
              },
              removeRetainedPieceIds: [pieces[1]!.stockItemId],
              retainedPieces: [
                {
                  id: pieces[0]!.stockItemId,
                  widthMm: 300,
                  lengthMm: 600,
                  locationId: location.id,
                },
                { widthMm: 200, lengthMm: 400, locationId: location.id },
              ],
            },
          ],
        };
        const key = randomUUID();
        const result = correctionResultSchema.parse(
          (
            await post(
              `/allocations/${record.id}/completion-corrections`,
              body,
              key,
            ).expect(200)
          ).body,
        );
        assert.equal(result.createdStockItemIds.length, 1);
        assert.equal((await readStock(source)).measurementThicknessMm, 0.5);
        assert.equal(
          (await readStock(pieces[0]!.stockItemId)).explicitLengthMm,
          600,
        );
        assert.ok((await readStock(pieces[1]!.stockItemId)).voidedAt);
        const corrected = allocationDetailSchema.parse(
          (await get(`/allocations/${record.id}`).expect(200)).body,
        );
        assert.equal(corrected.completedAt, record.completedAt);
        assert.equal(
          corrected.completion!.submittedByUserId,
          record.completion!.submittedByUserId,
        );
        assert.ok(corrected.correctedAt);
        assert.ok(
          corrected.completion!.createdStockItemIds.includes(
            pieces[0]!.stockItemId,
          ),
        );
        await post(
          `/allocations/${record.id}/completion-corrections`,
          body,
          key,
        ).expect(200);
        await post(
          `/allocations/${record.id}/complete`,
          originalInput,
          originalKey,
        ).expect(200);
        const next = await completionContext(record.id);
        await post(`/allocations/${record.id}/completion-corrections`, {
          ...body,
          expectedRevision: next.record.revision,
          stockVersions: versions(next),
          items: [
            {
              outcome: {
                ...body.items[0]!.outcome,
                expectedRevision: next.eligibility.find(
                  (e) => e.stockItemId === source,
                )!.revision,
                radialDepthMm: 13,
              },
              retainedPieces: next.effects
                .filter((e) => !e.before && !e.after.voidedAt)
                .map((e) => ({
                  id: e.stockItemId,
                  widthMm: e.after.widthMm,
                  lengthMm: e.after.explicitLengthMm,
                  locationId: e.after.locationId,
                })),
            },
          ],
        }).expect(200);
        const originalEvent = historySchema
          .parse(
            (await get(`/allocations/${record.id}/history`).expect(200)).body,
          )
          .items.find((e) => e.action === 'allocation.completed')!;
        const snapshot = originalEvent.changes.find(
          (c) => c.recordId === record.id,
        )!.after!;
        assert.equal(snapshot.type, 'allocations');
        if (snapshot.type === 'allocations' && snapshot.value.state !== 'draft')
          assert.equal(snapshot.value.correctedAt, null);
      },
    );
    await t.test(
      'later reservations and current stock changes block historical cutting corrections',
      async () => {
        const r = await receipt(1);
        const { record } = await complete(
          await allocate(r.items[0]!.stockItemIds[0]!),
        );
        const id = record.items[0]!.stockItemId;
        const nextAllocation = await allocate(id);
        let c = await completionContext(record.id);
        assert.ok(
          c.eligibility
            .find((e) => e.stockItemId === id)!
            .blockers.some((b) => b.code === 'reserved'),
        );
        await post(`/allocations/${nextAllocation.id}/cancel`, {
          expectedRevision: nextAllocation.revision,
        }).expect(200);
        const s = await readStock(id);
        await post(`/stock-items/${id}/corrections`, {
          reason: 'New measurement',
          expectedRevision: s.revision,
          changes: { radialDepthMm: 14 },
        }).expect(200);
        c = await completionContext(record.id);
        assert.ok(
          c.eligibility
            .find((e) => e.stockItemId === id)!
            .blockers.some((b) => b.code === 'changed'),
        );
      },
    );
    await t.test(
      'stock shortages and reduced cutting width flag active allocations without rejecting observed stock',
      async () => {
        const r = await receipt(1),
          s = r.items[0]!.stockItems[0]!,
          a = await allocate(s.id);
        const result = correctionResultSchema.parse(
          (
            await post(`/stock-items/${s.id}/corrections`, {
              reason: 'Narrower fabric',
              expectedRevision: s.revision,
              changes: { widthMm: 400 },
            }).expect(200)
          ).body,
        );
        assert.ok(result.affectedAllocationIds.includes(a.id));
        assert.equal(
          (await get(`/allocations/${a.id}`).expect(200)).body.needsReplanning,
          true,
        );
      },
    );
    await t.test(
      'audit insertion failure rolls back correction, stock and retry claim',
      async (t) => {
        const r = await receipt(1),
          c = await receiptContext(r.id),
          id = r.items[0]!.stockItemIds[0]!;
        const body = {
          reason: 'Rollback proof',
          expectedRevision: r.revision,
          operations: [
            {
              action: 'update',
              lineId: r.items[0]!.id,
              data: { ...line, quantity: 3 },
            },
          ],
          stockVersions: versions(c),
        };
        const key = randomUUID();
        const fail = t.mock.method(
          AuditRepository.prototype,
          'insertEvent',
          async () => {
            throw new Error('Simulated audit storage failure');
          },
        );
        await post(`/stock-receipts/${r.id}/corrections`, body, key).expect(
          503,
        );
        fail.mock.restore();
        assert.equal((await readStock(id)).revision, 1);
        assert.equal(
          (await get(`/stock-receipts/${r.id}`).expect(200)).body.items[0]
            .stockItemIds.length,
          1,
        );
        const result = correctionResultSchema.parse(
          (
            await post(`/stock-receipts/${r.id}/corrections`, body, key).expect(
              200,
            )
          ).body,
        );
        assert.equal(result.createdStockItemIds.length, 2);
      },
    );
    await t.test(
      'returned remnant corrections reconstruct the original width and preserve its source identity',
      async () => {
        const opening = stockItemSchema.parse(
          (
            await post('/stock-items', {
              fabricColorId: color.id,
              isRemnant: true,
              isUsed: true,
              widthMm: 1500,
              initialLengthMm: 5000,
              explicitLengthMm: 5000,
              locationId: location.id,
            }).expect(201)
          ).body,
        );
        const a = await allocate(opening.id);
        const done = allocationDetailSchema.parse(
          (
            await post(`/allocations/${a.id}/complete`, {
              expectedRevision: a.revision,
              items: [
                {
                  stockItemId: opening.id,
                  expectedRevision: opening.revision,
                  outcome: 'returned-remnant',
                  widthMm: 1000,
                  explicitLengthMm: 3000,
                  locationId: location.id,
                  scraps: [],
                },
              ],
            }).expect(200)
          ).body,
        );
        const context = await completionContext(a.id);
        const body = {
          reason: 'Remaining width was misread',
          expectedRevision: done.revision,
          stockVersions: versions(context),
          items: [
            {
              outcome: {
                stockItemId: opening.id,
                expectedRevision: context.eligibility[0]!.revision,
                outcome: 'returned-remnant',
                widthMm: 1400,
                explicitLengthMm: 3200,
                locationId: location.id,
                scraps: [],
              },
              retainedPieces: [],
              removeRetainedPieceIds: [],
            },
          ],
        };
        await post(`/allocations/${a.id}/completion-corrections`, {
          ...body,
          items: [
            {
              ...body.items[0]!,
              outcome: { ...body.items[0]!.outcome, widthMm: 1600 },
            },
          ],
        }).expect(400);
        await post(`/allocations/${a.id}/completion-corrections`, body).expect(
          200,
        );
        const result = await readStock(opening.id);
        assert.equal(result.id, opening.id);
        assert.equal(result.widthMm, 1400);
        assert.equal(result.explicitLengthMm, 3200);
        assert.equal(result.initialLengthMm, 5000);
        assert.equal(result.sourceStockItemId, opening.sourceStockItemId);
      },
    );
    await t.test(
      'mixed receipt operations roll back together and removed lines retain original values',
      async () => {
        const r = stockReceiptDetailSchema.parse(
          (
            await post('/stock-receipts', {
              purchaseOrderNumber: '30004',
              items: [line, line],
            }).expect(201)
          ).body,
        );
        const reserved = await allocate(r.items[0]!.stockItemIds[0]!);
        const context = await receiptContext(r.id);
        await post(`/stock-receipts/${r.id}/corrections`, {
          reason: 'Correct both entries',
          expectedRevision: r.revision,
          stockVersions: versions(context),
          operations: [
            {
              action: 'update',
              lineId: r.items[1]!.id,
              data: { ...line, widthMm: 1800 },
            },
            { action: 'remove', lineId: r.items[0]!.id },
          ],
        }).expect(409);
        assert.equal(
          (await readStock(r.items[1]!.stockItemIds[0]!)).widthMm,
          line.widthMm,
        );
        assert.equal(
          (await get(`/stock-receipts/${r.id}`).expect(200)).body.revision,
          r.revision,
        );
        await post(`/allocations/${reserved.id}/cancel`, {
          expectedRevision: reserved.revision,
        }).expect(200);
        await post(`/stock-receipts/${r.id}/corrections`, {
          reason: 'Line entered by mistake',
          expectedRevision: r.revision,
          stockVersions: versions(context),
          operations: [{ action: 'remove', lineId: r.items[0]!.id }],
        }).expect(200);
        const saved = stockReceiptDetailSchema.parse(
          (await get(`/stock-receipts/${r.id}`).expect(200)).body,
        );
        assert.ok(saved.items[0]!.voidedAt);
        assert.equal(saved.items[0]!.quantity, r.items[0]!.quantity);
        assert.deepEqual(
          saved.items[0]!.stockItemIds,
          r.items[0]!.stockItemIds,
        );
        assert.equal(saved.items[1]!.voidedAt, null);
      },
    );
    await t.test(
      'one completed source can be corrected when an unrelated source changed; legacy completions stay blocked',
      async () => {
        const r = await receipt(2),
          [first, second] = r.items[0]!.stockItems;
        const draft = plan(first!.id);
        draft.requirements[0]!.quantity = 2;
        draft.plan.cuts.push({
          ...draft.plan.cuts[0]!,
          stockItemId: second!.id,
        });
        const a = allocationDetailSchema.parse(
          (await post('/allocations', draft).expect(201)).body,
        );
        const done = allocationDetailSchema.parse(
          (
            await post(`/allocations/${a.id}/complete`, {
              expectedRevision: a.revision,
              items: [
                {
                  stockItemId: first!.id,
                  expectedRevision: first!.revision,
                  outcome: 'consumed',
                  tubeOuterDiameterMm: 50,
                  scraps: [],
                },
                {
                  stockItemId: second!.id,
                  expectedRevision: second!.revision,
                  outcome: 'returned-roll',
                  tubeOuterDiameterMm: 50,
                  radialDepthMm: 10,
                  locationId: location.id,
                  scraps: [],
                },
              ],
            }).expect(200)
          ).body,
        );
        const other = await readStock(second!.id);
        await post(`/stock-items/${other.id}/corrections`, {
          reason: 'Later width observation',
          expectedRevision: other.revision,
          changes: { widthMm: 1800 },
        }).expect(200);
        const context = await completionContext(a.id);
        const body = {
          reason: 'First roll was returned',
          expectedRevision: done.revision,
          stockVersions: versions(context),
          items: [
            {
              outcome: {
                stockItemId: first!.id,
                expectedRevision: context.eligibility.find(
                  (e) => e.stockItemId === first!.id,
                )!.revision,
                outcome: 'returned-roll',
                tubeOuterDiameterMm: 50,
                radialDepthMm: 10,
                locationId: location.id,
                scraps: [],
              },
              retainedPieces: [],
              removeRetainedPieceIds: [],
            },
          ],
        };
        await post(`/allocations/${a.id}/completion-corrections`, body).expect(
          200,
        );
        assert.equal((await readStock(first!.id)).consumedAt, null);
        assert.equal((await readStock(other.id)).widthMm, 1800);
        const saved = allocationDetailSchema.parse(
          (await get(`/allocations/${a.id}`).expect(200)).body,
        );
        assert.deepEqual(saved.completion!.items[1], done.completion!.items[1]);
        await post(`/allocations/${a.id}/completion-corrections`, {
          ...body,
          expectedRevision: saved.revision,
          stockVersions: versions(await completionContext(a.id)),
          items: [
            {
              ...body.items[0]!,
              outcome: {
                ...body.items[0]!.outcome,
                expectedRevision: (await readStock(first!.id)).revision,
              },
            },
          ],
        }).expect(400);
        await pool.query(
          `UPDATE "${schema}".allocations SET stock_effects=NULL WHERE id=$1`,
          [a.id],
        );
        const legacyInput = completeAllocationRequestSchema.parse({
          expectedRevision: a.revision,
          items: done.completion!.items.map((item) => {
            const { expectedRevision: _revision, ...fields } = item as {
              expectedRevision: number;
              stockItemId: string;
            };
            void _revision;
            return { ...fields, expectedUpdatedAt: r.createdAt };
          }),
        });
        const legacyKey = randomUUID();
        await pool.query(
          `UPDATE "${schema}".allocations SET completion=$2, completion_key=$3, completion_request_hash=$4, effective_completion=NULL WHERE id=$1`,
          [
            a.id,
            JSON.stringify({ ...done.completion, items: legacyInput.items }),
            legacyKey,
            createHash('sha256')
              .update(JSON.stringify(legacyInput))
              .digest('hex'),
          ],
        );
        const legacyRecord = allocationDetailSchema.parse(
          (await get(`/allocations/${a.id}`).expect(200)).body,
        );
        assert.ok('expectedUpdatedAt' in legacyRecord.completion!.items[0]!);
        await post(
          `/allocations/${a.id}/complete`,
          legacyInput,
          legacyKey,
        ).expect(200);
        assert.equal((await completionContext(a.id)).baselineAvailable, false);
        await post(`/allocations/${a.id}/completion-corrections`, {
          ...body,
          expectedRevision: saved.revision,
        }).expect(409);
      },
    );
    await t.test(
      'receipt correction racing reservation and stock correction racing completion serialize safely',
      async () => {
        const r = await receipt(1),
          c = await receiptContext(r.id),
          s = r.items[0]!.stockItems[0]!;
        const race = await Promise.all([
          post(`/stock-receipts/${r.id}/corrections`, {
            reason: 'Extra line',
            expectedRevision: r.revision,
            operations: [{ action: 'remove', lineId: r.items[0]!.id }],
            stockVersions: versions(c),
          }),
          post('/allocations', plan(s.id)),
        ]);
        assert.equal(race.filter((r) => r.status === 409).length, 1);
        assert.equal(
          race.filter((r) => r.status === 200 || r.status === 201).length,
          1,
        );
        const second = await receipt(1),
          a = await allocate(second.items[0]!.stockItemIds[0]!),
          item = a.items[0]!.stockItem;
        const completed = await Promise.all([
          post(`/stock-items/${item.id}/corrections`, {
            reason: 'New width',
            expectedRevision: item.revision,
            changes: { widthMm: 1800 },
          }),
          post(`/allocations/${a.id}/complete`, {
            expectedRevision: a.revision,
            items: [
              {
                stockItemId: item.id,
                expectedRevision: item.revision,
                outcome: 'consumed',
                tubeOuterDiameterMm: 50,
                scraps: [],
              },
            ],
          }),
        ]);
        assert.deepEqual(completed.map((r) => r.status).sort(), [200, 409]);
      },
    );
  } finally {
    await role('user');
  }
}
