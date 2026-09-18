import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'pg';
import request from 'supertest';
import {
  allocationDraftSchema,
  allocationDraftDataSchema,
  allocationRecordSchema,
  type CreateAllocation,
} from '@roller-bay/shared/allocations';
import { AllocationsService } from './allocations.service.js';
import { AllocationsRepository } from './allocations.repository.js';

export async function testAllocationDrafts(
  t: TestContext,
  app: INestApplication,
  pool: Pool,
  schema: string,
  cookie: string,
  origin: string,
  seed: (length?: number, remnant?: boolean) => Promise<string>,
  input: (id: string, length?: number) => CreateAllocation,
) {
  const path = '/api/allocations';
  const server = app.getHttpServer();
  const ids: string[] = [];
  const colleague = randomUUID();
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
  const create = async (data: object, key: string = randomUUID()) => {
    const draft = allocationDraftSchema.parse(
      (await post(`${path}/drafts`, { data }, key).expect(201)).body,
    );
    ids.push(draft.id);
    return draft;
  };
  try {
    await pool.query(
      `INSERT INTO "${schema}".users (id,name,email,microsoft_subject_id,role) VALUES ($1,'Allocation draft colleague',$2,$3,'user')`,
      [colleague, `${colleague}@example.com`, colleague],
    );
    await t.test(
      'allocation drafts preserve ordered partial rows and unassigned cuts without reserving stock',
      async () => {
        const stockId = await seed(1000);
        const complete = input(stockId);
        const partial = {
          requirements: [
            { id: randomUUID(), widthMm: 42 },
            complete.requirements[0],
          ],
          plan: {
            cuts: [
              {},
              complete.plan.cuts[0],
              { stockItemId: stockId, items: [] },
              {},
            ],
          },
        };
        const draft = await create(partial);
        assert.deepEqual(
          draft.data.requirements.map((item) => item.id),
          partial.requirements.map((item) => item!.id),
        );
        // Only the assigned cut has a derived length; the test allowance is zero.
        assert.deepEqual(
          draft.data.plan.cuts.map((cut) => cut.lengthMm),
          [null, 1000, null, null],
        );
        assert.deepEqual(
          (await get(draft.id).expect(200)).body.data,
          draft.data,
        );
        const savedItems = await pool.query(
          `SELECT stock_item_id,reserved_length_mm FROM "${schema}".allocation_items WHERE allocation_id=$1`,
          [draft.id],
        );
        assert.equal(savedItems.rowCount, 3);
        assert.equal(
          savedItems.rows.filter((row) => row.stock_item_id === null).length,
          2,
        );
        assert.ok(
          savedItems.rows.every((row) => row.reserved_length_mm === null),
        );
        const preview = {
          requirements: complete.requirements,
          plan: complete.plan,
        };
        assert.equal(
          (await post(`${path}/validate`, preview).expect(200)).body.valid,
          true,
        );
        assert.equal(
          (
            await post(`${path}/validate`, {
              ...preview,
              allocationId: draft.id,
              expectedRevision: 1,
            }).expect(200)
          ).body.valid,
          true,
        );
        await post(`${path}/${draft.id}/submit`, {
          expectedRevision: 1,
        }).expect(400);
        await post(`${path}/${draft.id}/cancel`, {
          expectedRevision: 1,
        }).expect(409);
        const ordinary = await request(server)
          .get(path)
          .set('Cookie', cookie)
          .expect(200);
        assert.ok(
          !ordinary.body.items.some(
            (item: { id: string }) => item.id === draft.id,
          ),
        );
        const drafts = await request(server)
          .get(`${path}?state=draft`)
          .set('Cookie', cookie)
          .expect(200);
        assert.ok(
          drafts.body.items.some(
            (item: { id: string; needsReplanning: boolean }) =>
              item.id === draft.id && !item.needsReplanning,
          ),
        );
      },
    );
    await t.test(
      'allocation draft creation retries, references, revisions and deletion are checked',
      async () => {
        const key = randomUUID();
        const draft = await create({}, key);
        assert.equal(
          (await post(`${path}/drafts`, { data: {} }, key).expect(201)).body.id,
          draft.id,
        );
        await post(
          `${path}/drafts`,
          { data: { orderNumber: 'different' } },
          key,
        ).expect(409);
        await put(draft.id, 1, {
          requirements: [{ id: randomUUID(), fabricColorId: randomUUID() }],
        }).expect(404);
        await put(draft.id, 1, {
          plan: { cuts: [{ stockItemId: randomUUID() }] },
        }).expect(404);
        await put(draft.id, 1, {
          plan: { cuts: [{ items: [{ requirementId: randomUUID() }] }] },
        }).expect(400);
        const updates = await Promise.all([
          put(draft.id, 1, { orderNumber: 'A' }),
          put(draft.id, 1, { orderNumber: 'B' }),
        ]);
        assert.deepEqual(
          updates.map((value) => value.status).sort(),
          [200, 409],
        );
        await remove(draft.id, 1).expect(409);
        await remove(draft.id, 2).expect(204);
        await get(draft.id).expect(404);
      },
    );
    await t.test(
      'shared allocation drafts submit once with stable allocation and requirement IDs',
      async () => {
        const body = input(await seed(1000));
        const draft = allocationDraftSchema.parse(
          await app
            .get(AllocationsService)
            .createDraft(
              allocationDraftDataSchema.parse({ ...body, orderNumber: 'RB-1' }),
              colleague,
              randomUUID(),
            ),
        );
        ids.push(draft.id);
        // Drafts keep partial order numbers; submission requires six digits.
        await post(`${path}/${draft.id}/submit`, {
          expectedRevision: 1,
        }).expect(400);
        await put(draft.id, 1, body).expect(200);
        const responses = await Promise.all([
          post(`${path}/${draft.id}/submit`, { expectedRevision: 2 }),
          post(`${path}/${draft.id}/submit`, { expectedRevision: 2 }),
        ]);
        assert.deepEqual(
          responses.map((response) => response.status),
          [200, 200],
        );
        const saved = allocationRecordSchema.parse(
          (await get(draft.id).expect(200)).body,
        );
        assert.equal(saved.state, 'active');
        assert.equal(saved.id, draft.id);
        assert.equal(saved.createdByUserId, colleague);
        assert.equal(saved.requirements[0]!.id, body.requirements[0]!.id);
        assert.equal(saved.items[0]!.reservedLengthMm, 1000);
        assert.equal(saved.revision, 3);
        await put(draft.id, 3, body).expect(409);
        await remove(draft.id, 3).expect(409);
        await post(`${path}/${draft.id}/submit`, {
          expectedRevision: 3,
        }).expect(409);
      },
    );
    await t.test(
      'competing draft submissions cannot over-reserve and failed submission remains editable',
      async () => {
        const stock = await seed(1000);
        const drafts = [await create(input(stock)), await create(input(stock))];
        const responses = await Promise.all(
          drafts.map((draft) =>
            post(`${path}/${draft.id}/submit`, { expectedRevision: 1 }),
          ),
        );
        assert.deepEqual(
          responses.map((response) => response.status).sort(),
          [200, 409],
        );
        const loser =
          drafts[responses.findIndex((response) => response.status === 409)]!;
        const unchanged = allocationDraftSchema.parse(
          (await get(loser.id).expect(200)).body,
        );
        assert.equal(unchanged.revision, 1);
        assert.equal(
          (await get(loser.id).expect(200)).body.needsReplanning,
          false,
        );
        await put(loser.id, 1, input(await seed(1000))).expect(200);
        await post(`${path}/${loser.id}/submit`, {
          expectedRevision: 2,
        }).expect(200);
      },
    );
    await t.test(
      'failed plan persistence rolls back draft submission and permits retry',
      async (subtest) => {
        const draft = await create(input(await seed(1000)));
        const original = AllocationsRepository.prototype.replacePlan;
        const failure = subtest.mock.method(
          AllocationsRepository.prototype,
          'replacePlan',
          async function (
            this: AllocationsRepository,
            ...args: Parameters<typeof original>
          ) {
            await original.apply(this, args);
            throw new Error('Injected after plan insertion');
          },
        );
        try {
          await post(`${path}/${draft.id}/submit`, {
            expectedRevision: 1,
          }).expect(503);
        } finally {
          failure.mock.restore();
        }
        const unchanged = allocationDraftSchema.parse(
          (await get(draft.id).expect(200)).body,
        );
        assert.deepEqual(unchanged.data, draft.data);
        assert.equal(unchanged.revision, 1);
        const reservations = await pool.query(
          `SELECT reserved_length_mm FROM "${schema}".allocation_items WHERE allocation_id=$1`,
          [draft.id],
        );
        assert.ok(
          reservations.rows.every((row) => row.reserved_length_mm === null),
        );
        await post(`${path}/${draft.id}/submit`, {
          expectedRevision: 1,
        }).expect(200);
      },
    );
    await t.test(
      'database constraints enforce every required confirmed planning field and reject incomplete transitions',
      async () => {
        const draft = await create(input(await seed(1000)));
        await post(`${path}/${draft.id}/submit`, {
          expectedRevision: 1,
        }).expect(200);
        const client = await pool.connect();
        const children = [
          {
            table: 'allocation_requirements',
            fields: [
              'fabric_color_id',
              'width_mm',
              'length_mm',
              'length_allowance_mm',
              'quantity',
            ],
            where: 'allocation_id=$1',
          },
          {
            table: 'allocation_items',
            fields: ['stock_item_id', 'reserved_length_mm'],
            where: 'allocation_id=$1',
          },
          {
            table: 'allocation_cuts',
            fields: ['planned_length_mm', 'edge_trim_mm'],
            where: `allocation_item_id IN (SELECT id FROM "${schema}".allocation_items WHERE allocation_id=$1)`,
          },
          {
            table: 'allocation_cut_items',
            fields: ['quantity'],
            where: `allocation_cut_id IN (SELECT c.id FROM "${schema}".allocation_cuts c JOIN "${schema}".allocation_items i ON i.id=c.allocation_item_id WHERE i.allocation_id=$1)`,
          },
        ];
        try {
          for (const { table, fields, where } of children) {
            for (const field of fields) {
              await client.query('BEGIN');
              await client.query(
                `UPDATE "${schema}".${table} SET ${field}=NULL WHERE ${where}`,
                [draft.id],
              );
              await assert.rejects(client.query('COMMIT'), {
                code: '23514',
                constraint: 'allocations_confirmed_fields_required',
              });
            }
          }
          const partial = await create({
            orderNumber: 'INCOMPLETE',
            requirements: [{ id: randomUUID() }],
          });
          await assert.rejects(
            pool.query(
              `UPDATE "${schema}".allocations SET is_draft=false, confirmed_at=now() WHERE id=$1`,
              [partial.id],
            ),
            {
              code: '23514',
              constraint: 'allocations_confirmed_fields_required',
            },
          );
          assert.equal((await get(partial.id).expect(200)).body.state, 'draft');
        } finally {
          await client.query('ROLLBACK');
          client.release();
        }
      },
    );
  } finally {
    await pool.query(
      `DELETE FROM "${schema}".allocation_cut_items WHERE allocation_cut_id IN (SELECT c.id FROM "${schema}".allocation_cuts c JOIN "${schema}".allocation_items i ON i.id=c.allocation_item_id WHERE i.allocation_id=ANY($1::uuid[]))`,
      [ids],
    );
    await pool.query(
      `DELETE FROM "${schema}".allocation_cuts WHERE allocation_item_id IN (SELECT id FROM "${schema}".allocation_items WHERE allocation_id=ANY($1::uuid[]))`,
      [ids],
    );
    await pool.query(
      `DELETE FROM "${schema}".allocation_items WHERE allocation_id=ANY($1::uuid[])`,
      [ids],
    );
    await pool.query(
      `DELETE FROM "${schema}".allocation_requirements WHERE allocation_id=ANY($1::uuid[])`,
      [ids],
    );
    await pool.query(
      `DELETE FROM "${schema}".allocations WHERE id=ANY($1::uuid[])`,
      [ids],
    );
    await pool.query(`DELETE FROM "${schema}".users WHERE id=$1`, [colleague]);
  }
}
