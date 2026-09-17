import { stockCorrectionRequest } from '../../database/testing/stock-correction-request.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'pg';
import request from 'supertest';
import {
  stockItemSchema,
  stockItemListSchema,
} from '@roller-bay/shared/stock-items';

export async function testStockItems(
  t: TestContext,
  app: INestApplication,
  pool: Pool,
  schema: string,
  cookie: string,
  userId: string,
  origin: string,
) {
  const server = app.getHttpServer();
  const path = '/api/stock-items';
  const get = (url: string) => request(server).get(url).set('Cookie', cookie);
  const post = (url: string, body: object) =>
    request(server)
      .post(url)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send(body);
  const patch = (url: string, body: object) =>
    url.startsWith(path + '/')
      ? stockCorrectionRequest(server, cookie, origin, url, body)
      : request(server)
          .patch(url)
          .set('Cookie', cookie)
          .set('Origin', origin)
          .send(body);
  const remove = (url: string) =>
    url.startsWith(path + '/')
      ? stockCorrectionRequest(server, cookie, origin, url)
      : request(server).delete(url).set('Cookie', cookie).set('Origin', origin);
  const role = (value: string) =>
    pool.query(`UPDATE "${schema}".users SET role=$1 WHERE id=$2`, [
      value,
      userId,
    ]);
  const read = async (id: string) =>
    stockItemSchema.parse((await get(`${path}/${id}`).expect(200)).body);
  try {
    await t.test(
      'stock reads require active sessions and basic writes require admin or owner',
      async () => {
        await request(server).get(path).expect(401);
        await request(server).get(`${path}/${randomUUID()}`).expect(401);
        await request(server)
          .post(path)
          .set('Origin', origin)
          .send({})
          .expect(401);
        await request(server)
          .post(`${path}/${randomUUID()}/corrections`)
          .set('Origin', origin)
          .send({})
          .expect(401);
        await request(server)
          .post(`${path}/${randomUUID()}/void`)
          .set('Origin', origin)
          .expect(401);
        await role('user');
        await get(path).expect(200);
        await post(path, {}).expect(403);
        await patch(`${path}/${randomUUID()}`, {}).expect(403);
        await remove(`${path}/${randomUUID()}`).expect(403);
        for (const value of ['owner', 'admin']) {
          await role(value);
          await post(path, {}).expect(400);
          await patch(`${path}/${randomUUID()}`, {}).expect(400);
          await remove(`${path}/${randomUUID()}`).expect(404);
        }
        await request(server)
          .post(path)
          .set('Cookie', cookie)
          .send({})
          .expect(403);
        await request(server)
          .post(path)
          .set('Cookie', cookie)
          .set('Origin', 'https://attacker.example')
          .send({})
          .expect(403);
        await pool.query(
          `UPDATE "${schema}".users SET is_active=false WHERE id=$1`,
          [userId],
        );
        await get(path).expect(403);
        await post(path, {}).expect(403);
        await pool.query(
          `UPDATE "${schema}".users SET is_active=true WHERE id=$1`,
          [userId],
        );
      },
    );

    await t.test(
      'stock CRUD validates measurements, derives balances, filters stock, and protects references',
      async () => {
        const maker = (
          await post('/api/fabric-catalog/manufacturers', {
            name: 'Stock maker',
          }).expect(201)
        ).body;
        const material = (
          await post('/api/fabric-catalog/materials', {
            name: 'Stock material',
            manufacturerId: maker.id,
          }).expect(201)
        ).body;
        const color = (
          await post('/api/fabric-catalog/colors', {
            materialId: material.id,
            code: 'STOCK-1',
            thicknessMm: 0.5,
          }).expect(201)
        ).body;
        const otherColor = (
          await post('/api/fabric-catalog/colors', {
            materialId: material.id,
            code: 'STOCK-2',
            thicknessMm: 0.3,
          }).expect(201)
        ).body;
        const zone = (
          await post('/api/locations/zones', {
            name: 'Stock warehouse',
          }).expect(201)
        ).body;
        const section = (
          await post('/api/locations/sections', {
            zoneId: zone.id,
            label: '3',
          }).expect(201)
        ).body;
        const location = (
          await post('/api/locations', {
            sectionId: section.id,
            label: 'B',
          }).expect(201)
        ).body;
        const input = {
          fabricColorId: color.id,
          widthMm: 2000,
          initialLengthMm: 10000,
          locationId: location.id,
        };
        // Bypass HTTP validation to prove the migrated table enforces these rules.
        for (const [
          isRemnant,
          isUsed,
          tube,
          depth,
          locationId,
          code,
          constraint,
        ] of [
          [
            false,
            false,
            50,
            null,
            location.id,
            '23514',
            'fabric_stock_items_tube_usage',
          ],
          [
            false,
            true,
            null,
            null,
            location.id,
            '23514',
            'fabric_stock_items_tube_usage',
          ],
          [
            true,
            false,
            50,
            null,
            location.id,
            '23514',
            'fabric_stock_items_tube_usage',
          ],
          [
            true,
            true,
            50,
            null,
            location.id,
            '23514',
            'fabric_stock_items_tube_usage',
          ],
          [false, false, null, null, null, '23502', undefined],
        ] as const) {
          await assert.rejects(
            pool.query(
              `INSERT INTO "${schema}".fabric_stock_items
                (fabric_color_id, is_remnant, is_used, width_mm, initial_length_mm,
                 explicit_length_mm, tube_outer_diameter_mm, radial_depth_mm,
                 measurement_thickness_mm, location_id)
               VALUES ($1, $2, $3, 1000, 1000, $4, $5, $6, $7, $8)`,
              [
                color.id,
                isRemnant,
                isUsed,
                isRemnant ? 1000 : null,
                tube,
                depth,
                depth === null ? null : 0.5,
                locationId,
              ],
            ),
            (error: unknown) => {
              assert.ok(error instanceof Error && 'code' in error);
              assert.equal(error.code, code);
              if (constraint) {
                assert.ok('constraint' in error);
                assert.equal(error.constraint, constraint);
              }
              return true;
            },
          );
        }
        const create = async (body: object) =>
          stockItemSchema.parse((await post(path, body).expect(201)).body);
        const roll = await create(input);
        assert.equal(roll.isUsed, false);
        assert.equal(roll.remainingLengthMm, 10000);
        assert.equal(roll.explicitLengthMm, null);
        assert.equal(roll.measurementThicknessMm, null);
        assert.equal(roll.fabricColorCode, 'STOCK-1');
        assert.equal(roll.manufacturerName, maker.name);
        assert.equal(roll.materialName, material.name);
        assert.equal(roll.zoneName, zone.name);
        assert.equal(roll.sectionLabel, '3');
        assert.equal(roll.locationLabel, 'B');
        const remnant = await create({
          ...input,
          isRemnant: true,
          widthMm: 900,
          initialLengthMm: 1800,
          explicitLengthMm: 1800,
          sourceStockItemId: roll.id,
        });
        assert.equal(remnant.isUsed, false);
        await patch(`${path}/${remnant.id}`, { isUsed: true }).expect(200);
        assert.equal((await read(remnant.id)).tubeOuterDiameterMm, null);
        assert.equal(remnant.remainingLengthMm, 1800);
        assert.equal(remnant.zoneId, zone.id);
        assert.equal(remnant.locationLabel, 'B');
        const measured = await create({
          ...input,
          isUsed: true,
          radialDepthMm: 10,
          tubeOuterDiameterMm: 50,
        });
        assert.equal(measured.measurementThicknessMm, 0.5);
        assert.equal(measured.remainingLengthMm, 3769.911);
        const other = await create({
          ...input,
          fabricColorId: otherColor.id,
        });

        for (const invalid of [
          { explicitLengthMm: 1 },
          { radialDepthMm: 10 },
          { tubeOuterDiameterMm: 53 },
          { tubeOuterDiameterMm: 0 },
          { tubeOuterDiameterMm: 50 },
          { isUsed: true },
          { isUsed: 'true' },
          { locationId: null },
          { locationId: undefined },
          { widthMm: 0 },
          { widthMm: 1.1234 },
          { widthMm: '2000' },
          { initialLengthMm: -1 },
          { isRemnant: true },
          { remainingLengthMm: 1 },
          { measurementThicknessMm: 0.4 },
          { id: randomUUID() },
          { sourceStockItemId: roll.id },
          { consumedAt: 'yesterday' },
          { isRemnant: 'false' },
          { radialDepthMm: -1 },
        ])
          await post(path, { ...input, ...invalid }).expect(400);
        for (const invalid of [
          { radialDepthMm: 1 },
          { tubeOuterDiameterMm: 50 },
          { explicitLengthMm: null },
        ]) {
          await post(path, {
            ...input,
            isRemnant: true,
            explicitLengthMm: 1,
            ...invalid,
          }).expect(400);
        }
        await post(path, { ...input, fabricColorId: randomUUID() }).expect(404);
        await post(path, { ...input, locationId: randomUUID() }).expect(404);
        await post(path, {
          ...input,
          isRemnant: true,
          explicitLengthMm: 1,
          sourceStockItemId: randomUUID(),
        }).expect(404);
        await post(path, {
          ...input,
          fabricColorId: otherColor.id,
          isRemnant: true,
          explicitLengthMm: 1,
          sourceStockItemId: roll.id,
        }).expect(400);
        await get(`${path}/invalid`).expect(400);
        await get(`${path}/${randomUUID()}`).expect(404);
        await patch(`${path}/${randomUUID()}`, { widthMm: 100 }).expect(404);
        await patch(`${path}/${roll.id}`, {}).expect(400);
        for (const invalid of [
          { isRemnant: true },
          { fabricColorId: otherColor.id },
          { sourceStockItemId: remnant.id },
          { remainingLengthMm: 1 },
          { measurementThicknessMm: 0.3 },
        ])
          await patch(`${path}/${roll.id}`, invalid).expect(400);
        await patch(`${path}/${roll.id}`, { explicitLengthMm: 100 }).expect(
          400,
        );
        await patch(`${path}/${remnant.id}`, { explicitLengthMm: null }).expect(
          400,
        );
        await patch(`${path}/${measured.id}`, {
          tubeOuterDiameterMm: null,
        }).expect(400);
        assert.equal((await read(measured.id)).tubeOuterDiameterMm, 50);
        await patch(`${path}/${measured.id}`, { isUsed: false }).expect(400);
        await patch(`${path}/${roll.id}`, { isUsed: true }).expect(400);
        await patch(`${path}/${roll.id}`, { tubeOuterDiameterMm: 50 }).expect(
          400,
        );
        const used = stockItemSchema.parse(
          (
            await patch(`${path}/${roll.id}`, {
              isUsed: true,
              tubeOuterDiameterMm: 50,
            }).expect(200)
          ).body,
        );
        assert.equal(used.isUsed, true);
        await patch(`${path}/${roll.id}`, {
          isUsed: false,
          tubeOuterDiameterMm: null,
        }).expect(200);

        await patch(`/api/fabric-catalog/colors/${color.id}`, {
          thicknessMm: 0.25,
        }).expect(200);
        await patch(`${path}/${measured.id}`, { locationId: null }).expect(400);
        await patch(`${path}/${measured.id}`, {
          locationId: location.id,
        }).expect(400);
        assert.equal((await read(measured.id)).measurementThicknessMm, 0.5);
        assert.equal((await read(measured.id)).remainingLengthMm, 3769.911);
        const remeasured = stockItemSchema.parse(
          (
            await patch(`${path}/${measured.id}`, { radialDepthMm: 10 }).expect(
              200,
            )
          ).body,
        );
        assert.equal(remeasured.measurementThicknessMm, 0.25);
        assert.equal(remeasured.remainingLengthMm, 7539.822);
        assert.equal(remeasured.createdAt, measured.createdAt);
        assert.ok(
          Date.parse(remeasured.updatedAt) > Date.parse(measured.updatedAt),
        );
        await patch(`${path}/${measured.id}`, {
          radialDepthMm: 999999999,
          tubeOuterDiameterMm: 2147483645,
        }).expect(400);
        assert.equal((await read(measured.id)).radialDepthMm, 10);
        await patch(`${path}/${measured.id}`, { radialDepthMm: null }).expect(
          200,
        );
        assert.equal((await read(measured.id)).measurementThicknessMm, null);
        assert.equal((await read(measured.id)).remainingLengthMm, 10000);
        assert.equal((await read(measured.id)).isUsed, true);
        await patch(`${path}/${measured.id}`, {
          tubeOuterDiameterMm: null,
        }).expect(400);
        const revision = (await read(remnant.id)).revision;
        const parallel = await Promise.all(
          [{ explicitLengthMm: 1200 }, { widthMm: 800 }].map((changes) =>
            request(server)
              .post(`${path}/${remnant.id}/corrections`)
              .set('Cookie', cookie)
              .set('Origin', origin)
              .set('Idempotency-Key', randomUUID())
              .send({
                expectedRevision: revision,
                reason: 'Concurrent correction',
                changes,
              }),
          ),
        );
        assert.deepEqual(parallel.map((r) => r.status).sort(), [200, 409]);
        const current = await read(remnant.id);
        await patch(
          `${path}/${remnant.id}`,
          current.widthMm === 800
            ? { explicitLengthMm: 1200 }
            : { widthMm: 800 },
        ).expect(200);
        assert.equal((await read(remnant.id)).widthMm, 800);
        assert.equal((await read(remnant.id)).remainingLengthMm, 1200);

        const page = stockItemListSchema.parse(
          (
            await get(`${path}?fabricColorId=${color.id}&pageSize=1`).expect(
              200,
            )
          ).body,
        );
        assert.equal(page.total, 3);
        assert.equal(page.items[0]?.id, roll.id);
        assert.equal(
          (
            await get(
              `${path}?fabricColorId=${color.id}&pageSize=1&page=2`,
            ).expect(200)
          ).body.items[0].id,
          remnant.id,
        );
        const total = async (query: string) =>
          (await get(`${path}?${query}`).expect(200)).body.total;
        assert.equal(await total(`locationId=${location.id}`), 4);
        assert.equal(
          await total(`sectionId=${section.id}&zoneId=${zone.id}`),
          4,
        );
        assert.equal(await total(`zoneId=${randomUUID()}`), 0);
        assert.equal(await total('isRemnant=true'), 1);
        assert.equal(await total('isRemnant=false'), 3);
        assert.equal(
          await total('minWidthMm=1000&minRemainingLengthMm=5000'),
          3,
        );
        assert.equal(await total('search=stock-1'), 3);
        for (const search of ['%25', '_', '%5C'])
          assert.equal(await total(`search=${search}`), 0);
        for (const query of [
          'page=0',
          'pageSize=101',
          'isRemnant=1',
          'isConsumed=no',
          'zoneId=invalid',
          'minWidthMm=-1',
          'minRemainingLengthMm=0.1234',
          'unexpected=true',
        ])
          await get(`${path}?${query}`).expect(400);
        const consumedAt = new Date().toISOString();
        await patch(`${path}/${roll.id}`, { consumedAt }).expect(200);
        assert.equal((await read(roll.id)).remainingLengthMm, 0);
        assert.equal((await read(roll.id)).locationId, location.id);
        await patch(`${path}/${roll.id}`, { locationId: null }).expect(400);
        assert.equal(await total('isConsumed=false'), 3);
        assert.equal(await total('isConsumed=true'), 1);
        assert.equal((await get(path).expect(200)).body.total, 3);
        await patch(`${path}/${roll.id}`, { consumedAt: null }).expect(200);
        assert.equal((await read(roll.id)).remainingLengthMm, 10000);

        await remove(`${path}/${roll.id}`).expect(409);
        await remove(`/api/fabric-catalog/colors/${color.id}`).expect(409);
        await remove(`/api/locations/${location.id}`).expect(409);
        await role('user');
        await get(`${path}/${roll.id}`).expect(200);
        await patch(`${path}/${roll.id}`, { consumedAt }).expect(403);
        await remove(`${path}/${roll.id}`).expect(403);
        await role('owner');
        const owned = await create(input);
        await patch(`${path}/${owned.id}`, { widthMm: 1000 }).expect(200);
        await remove(`${path}/${owned.id}`).expect(200);
        await role('admin');
        for (const item of [remnant, measured, other]) {
          await remove(`${path}/${item.id}`).expect(200);
          assert.ok((await read(item.id)).voidedAt);
        }
        // A voided descendant still preserves its source relationship.
        await remove(`${path}/${roll.id}`).expect(409);
        assert.equal((await read(roll.id)).voidedAt, null);
        // Voiding retains stock and its references; catalog and storage records remain protected.
        await remove(`/api/locations/${location.id}`).expect(409);
        await remove(`/api/fabric-catalog/colors/${color.id}`).expect(409);
      },
    );
  } finally {
    await pool.query(
      `UPDATE "${schema}".users SET role='user', is_active=true WHERE id=$1`,
      [userId],
    );
  }
}
