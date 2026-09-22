import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { historySchema } from '@roller-bay/shared/audit';
import { correctionResultSchema } from '@roller-bay/shared/corrections';
import request from 'supertest';
import { startCorrectionsApp } from '../../testing/corrections-app.js';

test('stock corrections integration', { timeout: 60_000 }, async (t) => {
  const {
    server,
    cookie,
    userId,
    origin,
    get,
    post,
    role,
    receipt,
    receiptContext,
    versions,
    plan,
    allocate,
  } = await startCorrectionsApp(t);
  await t.test(
    'employees can read history but only admins correct; no unaudited stock write routes remain',
    async () => {
      const r = await receipt(1),
        s = r.items[0]!.stockItems[0]!;
      await role('staff');
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
    'receipt correction racing reservation and stock correction racing completion serialize safely',
    async () => {
      const r = await receipt(1),
        c = await receiptContext(r.id),
        s = r.items[0]!.stockItems[0]!;
      const competing = await plan(s.id);
      const race = await Promise.all([
        post(`/stock-receipts/${r.id}/corrections`, {
          reason: 'Extra line',
          expectedRevision: r.revision,
          operations: [{ action: 'remove', lineId: r.items[0]!.id }],
          stockVersions: versions(c),
        }),
        post('/allocations', competing),
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
});
