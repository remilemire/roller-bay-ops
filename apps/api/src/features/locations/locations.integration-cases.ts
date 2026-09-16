import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'pg';
import request from 'supertest';
import {
  locationSchema,
  locationZoneSchema,
  locationSectionSchema,
  locationListSchema,
} from '@roller-bay/shared/locations';

export async function testLocations(
  t: TestContext,
  app: INestApplication,
  pool: Pool,
  schema: string,
  cookie: string,
  userId: string,
  origin: string,
) {
  const server = app.getHttpServer();
  const paths = [
    '/api/locations/zones',
    '/api/locations/sections',
    '/api/locations',
  ];
  const [zones, sections, levels] = paths as [string, string, string];
  const get = (path: string) => request(server).get(path).set('Cookie', cookie);
  const post = (path: string, body: object) =>
    request(server)
      .post(path)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send(body);
  const patch = (path: string, body: object) =>
    request(server)
      .patch(path)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send(body);
  const remove = (path: string) =>
    request(server).delete(path).set('Cookie', cookie).set('Origin', origin);
  const role = (value: string) =>
    pool.query(`UPDATE "${schema}".users SET role=$1 WHERE id=$2`, [
      value,
      userId,
    ]);
  try {
    await t.test(
      'location reads require active sessions and every mutation requires admin or owner',
      async () => {
        await role('user');
        for (const path of paths) {
          await request(server).get(path).expect(401);
          await request(server).get(`${path}/${randomUUID()}`).expect(401);
          await request(server)
            .post(path)
            .set('Origin', origin)
            .send({})
            .expect(401);
          await get(path).expect(200);
          await post(path, {}).expect(403);
          await patch(`${path}/${randomUUID()}`, {}).expect(403);
          await remove(`${path}/${randomUUID()}`).expect(403);
          await post(`${path}/${randomUUID()}/move`, {
            targetId: randomUUID(),
            position: 'before',
          }).expect(403);
        }
        await role('owner');
        const zone = (await post(zones, { name: 'Owner zone' }).expect(201))
          .body;
        const section = (
          await post(sections, { zoneId: zone.id, label: 'Contracts' }).expect(
            201,
          )
        ).body;
        const level = (
          await post(levels, { sectionId: section.id, label: '1' }).expect(201)
        ).body;
        for (const [path, row, input] of [
          [zones, zone, { name: 'Owner renamed' }],
          [sections, section, { label: 'Contract orders' }],
          [levels, level, { label: 'A' }],
        ] as const) {
          await patch(`${path}/${row.id}`, input).expect(200);
          await request(server)
            .patch(`${path}/${row.id}`)
            .set('Cookie', cookie)
            .send(input)
            .expect(403);
          await request(server)
            .patch(`${path}/${row.id}`)
            .set('Cookie', cookie)
            .set('Origin', 'https://untrusted.example')
            .send(input)
            .expect(403);
        }
        await pool.query(
          `UPDATE "${schema}".users SET is_active=false WHERE id=$1`,
          [userId],
        );
        for (const path of paths) await get(path).expect(403);
        await pool.query(
          `UPDATE "${schema}".users SET is_active=true WHERE id=$1`,
          [userId],
        );
        await remove(`${levels}/${level.id}`).expect(204);
        await remove(`${sections}/${section.id}`).expect(204);
        await remove(`${zones}/${zone.id}`).expect(204);
        await role('admin');
      },
    );

    await t.test(
      'location CRUD enforces hierarchy, scoped uniqueness, immutable parents, and ordering',
      async () => {
        for (const path of paths) {
          await get(`${path}/invalid`).expect(400);
          await get(`${path}/${randomUUID()}`).expect(404);
          await remove(`${path}/${randomUUID()}`).expect(404);
          await patch(`${path}/${randomUUID()}`, {}).expect(400);
          await patch(`${path}/${randomUUID()}`, { sortOrder: 1 }).expect(404);
          for (const query of ['page=0', 'pageSize=101', 'unexpected=yes'])
            await get(`${path}?${query}`).expect(400);
          await post(path, { unexpected: true }).expect(400);
        }
        for (const name of ['', '   ', 'a'.repeat(121)])
          await post(zones, { name }).expect(400);
        for (const sortOrder of [-1, 0.5, '1', 2147483648, null])
          await post(zones, { name: 'Invalid sort', sortOrder }).expect(400);
        const zone = locationZoneSchema.parse(
          (
            await post(zones, { name: ' Primary Shelf ', sortOrder: 1 }).expect(
              201,
            )
          ).body,
        );
        assert.equal(zone.name, 'Primary Shelf');
        const otherZone = locationZoneSchema.parse(
          (await post(zones, { name: 'Warehouse' }).expect(201)).body,
        );
        await post(zones, { name: 'PRIMARY SHELF' }).expect(409);
        await patch(`${zones}/${otherZone.id}`, {
          name: 'primary shelf',
        }).expect(409);
        await post(sections, { zoneId: randomUUID(), label: 'A' }).expect(404);
        await post(levels, { sectionId: randomUUID(), label: 'A' }).expect(404);
        for (const label of ['', ' ', 'a'.repeat(41), null, 1]) {
          await post(sections, { zoneId: zone.id, label }).expect(400);
        }
        const section = locationSectionSchema.parse(
          (
            await post(sections, {
              zoneId: zone.id,
              label: ' Contracts ',
            }).expect(201)
          ).body,
        );
        assert.equal(section.zoneName, zone.name);
        assert.equal(section.label, 'Contracts');
        const otherSection = locationSectionSchema.parse(
          (
            await post(sections, {
              zoneId: otherZone.id,
              label: 'Contracts',
            }).expect(201)
          ).body,
        );
        await post(sections, { zoneId: zone.id, label: 'CONTRACTS' }).expect(
          409,
        );
        await patch(`${sections}/${section.id}`, {
          zoneId: otherZone.id,
          label: 'Moved',
        }).expect(400);
        const level = locationSchema.parse(
          (
            await post(levels, {
              sectionId: section.id,
              label: ' 2 ',
              sortOrder: 0,
            }).expect(201)
          ).body,
        );
        assert.equal(level.label, '2');
        assert.equal(level.sectionLabel, 'Contracts');
        assert.equal(level.zoneId, zone.id);
        assert.equal(level.zoneName, zone.name);
        for (const label of ['', ' ', 'a'.repeat(41), null, 1])
          await post(levels, { sectionId: section.id, label }).expect(400);
        const later = locationSchema.parse(
          (
            await post(levels, {
              sectionId: section.id,
              label: '10',
              sortOrder: 1,
            }).expect(201)
          ).body,
        );
        await post(levels, { sectionId: section.id, label: '2' }).expect(409);
        await patch(`${levels}/${later.id}`, { label: '2' }).expect(409);
        await patch(`${levels}/${level.id}`, {
          sectionId: otherSection.id,
        }).expect(400);
        const separate = locationSchema.parse(
          (
            await post(levels, {
              sectionId: otherSection.id,
              label: '2',
            }).expect(201)
          ).body,
        );
        await remove(`${zones}/${zone.id}`).expect(409);
        await remove(`${sections}/${section.id}`).expect(409);
        const page = locationListSchema.parse(
          (
            await get(
              `${levels}?sectionId=${section.id}&zoneId=${zone.id}&pageSize=1`,
            ).expect(200)
          ).body,
        );
        assert.equal(page.total, 2);
        assert.equal(page.items[0]?.id, level.id);
        assert.equal(
          (
            await get(
              `${levels}?sectionId=${section.id}&pageSize=1&page=2`,
            ).expect(200)
          ).body.items[0].id,
          later.id,
        );
        assert.equal(
          (
            await get(
              `${levels}?sectionId=${section.id}&zoneId=${otherZone.id}`,
            ).expect(200)
          ).body.total,
          0,
        );
        assert.equal(
          (
            await get(`${sections}?zoneId=${zone.id}&search=contract`).expect(
              200,
            )
          ).body.total,
          1,
        );
        assert.equal(
          (await get(`${zones}?search=primary`).expect(200)).body.total,
          1,
        );
        assert.equal(
          (await get(`${levels}?search=10`).expect(200)).body.total,
          1,
        );
        for (const path of paths) {
          for (const search of ['%25', '_', '%5C'])
            assert.equal(
              (await get(`${path}?search=${search}`).expect(200)).body.total,
              0,
            );
        }
        await get(`${sections}?zoneId=invalid`).expect(400);
        await get(`${levels}?sectionId=invalid`).expect(400);
        await get(`${levels}?zoneId=invalid`).expect(400);
        const updated = locationSchema.parse(
          (
            await patch(`${levels}/${later.id}`, {
              sortOrder: 0,
              label: '1',
            }).expect(200)
          ).body,
        );
        assert.equal(updated.createdAt, later.createdAt);
        assert.ok(Date.parse(updated.updatedAt) > Date.parse(later.updatedAt));
        assert.equal(
          (await get(`${levels}?sectionId=${section.id}`).expect(200)).body
            .items[0].id,
          later.id,
        );
        await patch(`${zones}/${zone.id}`, { name: 'Primary updated' }).expect(
          200,
        );
        await patch(`${sections}/${section.id}`, {
          label: 'Contracts updated',
        }).expect(200);
        const refreshed = locationSchema.parse(
          (await get(`${levels}/${level.id}`).expect(200)).body,
        );
        assert.equal(refreshed.zoneName, 'Primary updated');
        assert.equal(refreshed.sectionLabel, 'Contracts updated');
        await role('user');
        await get(`${levels}/${level.id}`).expect(200);
        await patch(`${levels}/${level.id}`, { label: 'Denied' }).expect(403);
        await role('admin');
        for (const row of [level, later, separate]) {
          await remove(`${levels}/${row.id}`).expect(204);
          await get(`${levels}/${row.id}`).expect(404);
        }
        for (const row of [section, otherSection])
          await remove(`${sections}/${row.id}`).expect(204);
        for (const row of [zone, otherZone])
          await remove(`${zones}/${row.id}`).expect(204);
      },
    );

    await t.test(
      'concurrent case-insensitive location labels have exactly one winner',
      async () => {
        const zone = (await post(zones, { name: 'Concurrent' }).expect(201))
          .body;
        const section = (
          await post(sections, { zoneId: zone.id, label: 'A' }).expect(201)
        ).body;
        const results = await Promise.all(
          ['B', 'b'].map((label) =>
            post(levels, { sectionId: section.id, label }),
          ),
        );
        assert.deepEqual(
          results.map((result) => result.status).sort(),
          [201, 409],
        );
        await remove(
          `${levels}/${results.find((result) => result.status === 201)!.body.id}`,
        ).expect(204);
        await remove(`${sections}/${section.id}`).expect(204);
        await remove(`${zones}/${zone.id}`).expect(204);
      },
    );
    await t.test(
      'relative moves order all siblings atomically and reject other parents',
      async () => {
        await role('admin');
        const zone = (await post(zones, { name: 'Move zone' }).expect(201))
          .body;
        const section = (
          await post(sections, {
            zoneId: zone.id,
            label: 'Move section',
          }).expect(201)
        ).body;
        const otherSection = (
          await post(sections, {
            zoneId: zone.id,
            label: 'Other section',
          }).expect(201)
        ).body;
        const foreign = (
          await post(levels, {
            sectionId: otherSection.id,
            label: 'Foreign',
          }).expect(201)
        ).body;
        const rows: { id: string }[] = [];
        for (let i = 0; i < 27; i++)
          rows.push(
            (
              await post(levels, {
                sectionId: section.id,
                label: String(i).padStart(2, '0'),
              }).expect(201)
            ).body,
          );
        const ordered = async () =>
          (
            await get(`${levels}?sectionId=${section.id}&pageSize=100`).expect(
              200,
            )
          ).body.items as { id: string; sortOrder: number }[];
        const move = (id: string, targetId: string, position = 'before') =>
          post(`${levels}/${id}/move`, { targetId, position });
        await move(rows[26]!.id, rows[0]!.id).expect(204);
        let result = await ordered();
        assert.deepEqual(
          result.map((row) => row.id),
          [rows[26]!.id, ...rows.slice(0, 26).map((row) => row.id)],
        );
        assert.deepEqual(
          result.map((row) => row.sortOrder),
          Array.from({ length: 27 }, (_, i) => i),
        );
        await move(rows[26]!.id, rows[0]!.id).expect(204); // Safe replay of the same placement.
        assert.deepEqual(await ordered(), result);
        await move(rows[0]!.id, foreign.id).expect(409);
        await move(randomUUID(), rows[0]!.id).expect(404);
        await move(rows[0]!.id, rows[1]!.id, 'sideways').expect(400);
        assert.deepEqual(await ordered(), result);
        await request(server)
          .post(`${levels}/${rows[0]!.id}/move`)
          .set('Cookie', cookie)
          .send({ targetId: rows[1]!.id, position: 'before' })
          .expect(403);
        await Promise.all([
          move(rows[5]!.id, rows[26]!.id).expect(204),
          move(rows[6]!.id, rows[26]!.id).expect(204),
        ]);
        result = await ordered();
        assert.equal(new Set(result.map((row) => row.sortOrder)).size, 27);
        assert.deepEqual(
          new Set(result.slice(0, 2).map((row) => row.id)),
          new Set([rows[5]!.id, rows[6]!.id]),
        );
        // A database failure during the write must leave every sibling unchanged.
        await pool.query(
          `CREATE FUNCTION "${schema}".reject_location_move() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated write failure'; END $$`,
        );
        await pool.query(
          `CREATE TRIGGER reject_location_move BEFORE UPDATE ON "${schema}".locations FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_location_move()`,
        );
        try {
          await move(rows[25]!.id, rows[0]!.id).expect(503);
          assert.deepEqual(await ordered(), result);
        } finally {
          await pool.query(
            `DROP TRIGGER reject_location_move ON "${schema}".locations`,
          );
          await pool.query(`DROP FUNCTION "${schema}".reject_location_move()`);
        }
        await post(`${sections}/${otherSection.id}/move`, {
          targetId: section.id,
          position: 'before',
        }).expect(204);
        const sectionList = (
          await get(`${sections}?zoneId=${zone.id}`).expect(200)
        ).body.items;
        assert.equal(sectionList[0].id, otherSection.id);
        const zone2 = (
          await post(zones, { name: 'Move second zone' }).expect(201)
        ).body;
        await post(`${zones}/${zone2.id}/move`, {
          targetId: zone.id,
          position: 'after',
        }).expect(204);
        const zoneList = (await get(`${zones}?pageSize=100`).expect(200)).body
          .items;
        assert.equal(
          zoneList[
            zoneList.findIndex((row: { id: string }) => row.id === zone.id) + 1
          ].id,
          zone2.id,
        );
        for (const row of [...rows, foreign])
          await remove(`${levels}/${row.id}`).expect(204);
        for (const row of [section, otherSection])
          await remove(`${sections}/${row.id}`).expect(204);
        for (const row of [zone, zone2])
          await remove(`${zones}/${row.id}`).expect(204);
      },
    );
  } finally {
    await pool.query(
      `UPDATE "${schema}".users SET role='user', is_active=true WHERE id=$1`,
      [userId],
    );
  }
}
