import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  allocationDetailSchema,
  completeAllocationRequestSchema,
} from '@roller-bay/shared/allocations';
import { historySchema } from '@roller-bay/shared/audit';
import { correctionResultSchema } from '@roller-bay/shared/corrections';
import { stockItemSchema } from '@roller-bay/shared/stock-items';
import request from 'supertest';
import { startCorrectionsApp } from '../../testing/corrections-app.js';

test('completion corrections integration', { timeout: 60_000 }, async (t) => {
  const {
    server,
    pool,
    cookie,
    origin,
    get,
    post,
    color,
    location,
    receipt,
    readStock,
    completionContext,
    versions,
    plan,
    allocate,
    complete,
  } = await startCorrectionsApp(t);
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
    'one completed source can be corrected when an unrelated source changed; legacy completions stay blocked',
    async () => {
      const r = await receipt(2),
        [first, second] = r.items[0]!.stockItems;
      // Two of the order's one blind, cut from a roll each.
      const draft = await plan(first!.id, 2);
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
        `UPDATE allocations SET stock_effects=NULL WHERE id=$1`,
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
        `UPDATE allocations SET completion=$2, completion_key=$3, completion_request_hash=$4, effective_completion=NULL WHERE id=$1`,
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
});
