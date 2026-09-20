import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'pg';
import request from 'supertest';
import {
  stockReceiptDraftDataSchema,
  stockReceiptDraftSchema,
  stockReceiptRecordSchema,
} from '@roller-bay/shared/stock-receipts';
import { createFixtures } from '../../testing/fixtures.js';
import { StockReceiptsService } from './stock-receipts.service.js';
import { StockItemsRepository } from '../stock-items/stock-items.repository.js';

export async function testStockReceiptDrafts(
  t: TestContext,
  app: INestApplication,
  pool: Pool,
  cookie: string,
  userId: string,
  origin: string,
  line: {
    fabricColorId: string;
    widthMm: number;
    initialLengthMm: number;
    quantity: number;
    locationId: string;
  },
) {
  const server = app.getHttpServer();
  const path = '/api/stock-receipts';
  const ids: string[] = [];
  const get = (id: string) =>
    request(server).get(`${path}/${id}`).set('Cookie', cookie);
  const post = (url: string, body: object, key: string = randomUUID()) =>
    request(server)
      .post(url)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .set('Idempotency-Key', key)
      .send(body);
  const put = (id: string, expectedRevision: number, data: object) =>
    request(server)
      .put(`${path}/${id}/draft`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send({ expectedRevision, data });
  const remove = (id: string, expectedRevision: number) =>
    request(server)
      .delete(`${path}/${id}/draft`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send({ expectedRevision });
  const create = async (data: object = {}, key: string = randomUUID()) => {
    const response = await post(`${path}/drafts`, { data }, key).expect(201);
    const draft = stockReceiptDraftSchema.parse(response.body);
    ids.push(draft.id);
    return draft;
  };
  const stockCount = async () =>
    (await pool.query(`SELECT count(*)::int AS n FROM fabric_stock_items`))
      .rows[0].n;
  const colleague = await createFixtures(pool).createUser('Draft colleague');
  await t.test(
    'receipt drafts round-trip incomplete typed rows, preserve ordering and require auth/origin',
    async () => {
      await request(server)
        .post(`${path}/drafts`)
        .set('Origin', origin)
        .send({ data: {} })
        .expect(401);
      await request(server)
        .post(`${path}/drafts`)
        .set('Cookie', cookie)
        .send({ data: {} })
        .expect(403);
      const before = await stockCount();
      const draft = await create({ items: [{ widthMm: 1234.125 }, {}] });
      assert.equal(draft.data.items[0]!.quantity, null);
      assert.equal(draft.data.items[1]!.widthMm, null);
      assert.equal(await stockCount(), before);
      assert.deepEqual((await get(draft.id).expect(200)).body.data, draft.data);
      const rows = await pool.query(
        `SELECT position,width_mm,quantity FROM stock_receipt_items WHERE stock_receipt_id=$1 ORDER BY position`,
        [draft.id],
      );
      assert.deepEqual(
        rows.rows.map((row) => row.position),
        [1, 2],
      );
      assert.equal(rows.rows[0].width_mm, '1234.125');
      assert.equal(rows.rows[0].quantity, null);
      await post(`${path}/${draft.id}/submit`, {
        expectedRevision: 1,
      }).expect(400);
      assert.equal((await get(draft.id).expect(200)).body.revision, 1);
      const listed = await request(server)
        .get(path)
        .set('Cookie', cookie)
        .expect(200);
      assert.ok(
        !listed.body.items.some((item: { id: string }) => item.id === draft.id),
      );
      const drafts = await request(server)
        .get(`${path}?state=draft`)
        .set('Cookie', cookie)
        .expect(200);
      assert.ok(
        drafts.body.items.some((item: { id: string }) => item.id === draft.id),
      );
    },
  );
  await t.test(
    'receipt draft retries and revisions prevent lost edits and invalid references roll back',
    async () => {
      const key = randomUUID();
      const draft = await create({}, key);
      assert.equal(
        (await post(`${path}/drafts`, { data: {} }, key).expect(201)).body.id,
        draft.id,
      );
      await post(
        `${path}/drafts`,
        { data: { purchaseOrderNumber: 'changed' } },
        key,
      ).expect(409);
      const writes = await Promise.all([
        put(draft.id, 1, { purchaseOrderNumber: 'A' }),
        put(draft.id, 1, { purchaseOrderNumber: 'B' }),
      ]);
      assert.deepEqual(writes.map((value) => value.status).sort(), [200, 409]);
      await put(draft.id, 2, {
        items: [{ ...line, locationId: randomUUID() }],
      }).expect(404);
      assert.equal((await get(draft.id).expect(200)).body.revision, 2);
      await remove(draft.id, 1).expect(409);
      await remove(draft.id, 2).expect(204);
      await get(draft.id).expect(404);
    },
  );
  await t.test(
    'another employee can edit and submit a receipt draft once with the same record and line IDs',
    async () => {
      const data = stockReceiptDraftDataSchema.parse({
        purchaseOrderNumber: '40001',
        items: [line],
      });
      const shared = stockReceiptDraftSchema.parse(
        await app
          .get(StockReceiptsService)
          .createDraft(
            { ...data, purchaseOrderNumber: 'PO-1' },
            colleague,
            randomUUID(),
          ),
      );
      ids.push(shared.id);
      await get(shared.id).expect(200);
      // Drafts keep partial purchase-order numbers; submission requires five digits.
      await post(`${path}/${shared.id}/submit`, {
        expectedRevision: 1,
      }).expect(400);
      await put(shared.id, 1, data).expect(200);
      const lines = (
        await pool.query(
          `SELECT id FROM stock_receipt_items WHERE stock_receipt_id=$1`,
          [shared.id],
        )
      ).rows.map((row) => row.id);
      const before = await stockCount();
      const submitted = await Promise.all([
        post(`${path}/${shared.id}/submit`, { expectedRevision: 2 }),
        post(`${path}/${shared.id}/submit`, { expectedRevision: 2 }),
      ]);
      assert.deepEqual(
        submitted.map((value) => value.status),
        [200, 200],
      );
      assert.equal(await stockCount(), before + line.quantity);
      const saved = stockReceiptRecordSchema.parse(
        (await get(shared.id).expect(200)).body,
      );
      assert.equal(saved.state, 'submitted');
      if (saved.state !== 'submitted')
        throw new Error('Expected submitted receipt');
      assert.equal(saved.id, shared.id);
      assert.equal(saved.createdByUserId, colleague);
      assert.equal(saved.submittedByUserId, userId);
      assert.deepEqual(
        saved.items.map((item) => item.id),
        lines,
      );
      await put(shared.id, 3, data).expect(409);
      await remove(shared.id, 3).expect(409);
      await post(`${path}/${shared.id}/submit`, {
        expectedRevision: 3,
      }).expect(409);
    },
  );
  await t.test(
    'failed receipt draft submission rolls back stock writes and remains retryable',
    async (subtest) => {
      const draft = await create({
        purchaseOrderNumber: '40002',
        items: [line],
      });
      const before = await stockCount();
      const repository = app.get(StockItemsRepository);
      const original = repository.createReceivedRolls;
      const failure = subtest.mock.method(
        repository,
        'createReceivedRolls',
        async function (
          this: StockItemsRepository,
          ...args: Parameters<typeof original>
        ) {
          await original.apply(this, args);
          throw new Error('Injected after stock insertion');
        },
      );
      try {
        await post(`${path}/${draft.id}/submit`, {
          expectedRevision: 1,
        }).expect(503);
      } finally {
        failure.mock.restore();
      }
      assert.equal(await stockCount(), before);
      assert.equal((await get(draft.id).expect(200)).body.state, 'draft');
      await post(`${path}/${draft.id}/submit`, {
        expectedRevision: 1,
      }).expect(200);
    },
  );
  await t.test(
    'database constraints reject incomplete submitted lines and incomplete draft transitions',
    async () => {
      const draft = await create({
        purchaseOrderNumber: '40003',
        items: [line],
      });
      await post(`${path}/${draft.id}/submit`, {
        expectedRevision: 1,
      }).expect(200);
      const client = await pool.connect();
      try {
        for (const field of [
          'fabric_color_id',
          'width_mm',
          'initial_length_mm',
          'quantity',
          'location_id',
        ]) {
          await client.query('BEGIN');
          await client.query(
            `UPDATE stock_receipt_items SET ${field}=NULL WHERE stock_receipt_id=$1`,
            [draft.id],
          );
          await assert.rejects(client.query('COMMIT'), {
            code: '23514',
            constraint: 'stock_receipts_confirmed_fields_required',
          });
        }
        const partial = await create({
          purchaseOrderNumber: 'INCOMPLETE',
          items: [{}],
        });
        await assert.rejects(
          pool.query(
            `UPDATE stock_receipts SET is_draft=false, submitted_at=now(), submitted_by_user_id=$2 WHERE id=$1`,
            [partial.id, userId],
          ),
          {
            code: '23514',
            constraint: 'stock_receipts_confirmed_fields_required',
          },
        );
        assert.equal((await get(partial.id).expect(200)).body.state, 'draft');
      } finally {
        await client.query('ROLLBACK');
        client.release();
      }
    },
  );
  await t.test(
    'database constraints serialize raw child writes against confirmation under both isolation levels',
    async () => {
      for (const isolation of ['READ COMMITTED', 'REPEATABLE READ']) {
        const draft = await create({ purchaseOrderNumber: 'DB-RACE' });
        const child = await pool.connect();
        const header = await pool.connect();
        try {
          await child.query(`BEGIN ISOLATION LEVEL ${isolation}`);
          await child.query(
            `INSERT INTO stock_receipt_items (stock_receipt_id,position) VALUES ($1,1)`,
            [draft.id],
          );
          await header.query('BEGIN');
          await header.query(
            `UPDATE stock_receipts SET is_draft=false, submitted_at=now(), submitted_by_user_id=$2 WHERE id=$1`,
            [draft.id, userId],
          );
          const rejected = assert.rejects(child.query('COMMIT'), {
            code: isolation === 'REPEATABLE READ' ? '40001' : '23514',
          });
          await header.query('COMMIT');
          await rejected;
          const rows = await pool.query(
            `SELECT id FROM stock_receipt_items WHERE stock_receipt_id=$1`,
            [draft.id],
          );
          assert.equal(rows.rowCount, 0);
        } finally {
          await child.query('ROLLBACK');
          await header.query('ROLLBACK');
          child.release();
          header.release();
        }
      }
    },
  );
}
