import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'pg';
import request from 'supertest';
import {
  fabricColorListSchema,
  fabricColorSchema,
  fabricMaterialSchema,
  manufacturerSchema,
} from '@roller-bay/shared/fabric-catalog';

export async function testCatalog(
  t: TestContext,
  app: INestApplication,
  pool: Pool,
  cookie: string,
  userId: string,
  origin: string,
) {
  const routes = ['manufacturers', 'materials', 'colors'];
  const server = app.getHttpServer();
  const read = (path: string) =>
    request(server).get(`/api/fabric-catalog/${path}`).set('Cookie', cookie);
  const post = (path: string, body: object) =>
    request(server)
      .post(`/api/fabric-catalog/${path}`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send(body);
  const patch = (path: string, body: object) =>
    request(server)
      .patch(`/api/fabric-catalog/${path}`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send(body);
  const remove = (path: string) =>
    request(server)
      .delete(`/api/fabric-catalog/${path}`)
      .set('Cookie', cookie)
      .set('Origin', origin);
  const role = (value: string) =>
    pool.query(`UPDATE users SET role = $1 WHERE id = $2`, [value, userId]);

  try {
    await t.test(
      'catalog reads require a session; admins and the owner can mutate every resource',
      async () => {
        for (const route of routes) {
          await request(server).get(`/api/fabric-catalog/${route}`).expect(401);
          await request(server)
            .get(`/api/fabric-catalog/${route}/${randomUUID()}`)
            .expect(401);
          await request(server)
            .post(`/api/fabric-catalog/${route}`)
            .set('Origin', origin)
            .send({})
            .expect(401);
        }
        for (const value of ['user']) {
          await role(value);
          for (const route of routes) {
            await read(route).expect(200);
            await post(route, {}).expect(403);
            await patch(`${route}/${randomUUID()}`, {}).expect(403);
            await remove(`${route}/${randomUUID()}`).expect(403);
          }
        }
        await role('owner');
        for (const route of routes) {
          await post(route, {}).expect(400);
          await patch(`${route}/${randomUUID()}`, {}).expect(400);
          await remove(`${route}/${randomUUID()}`).expect(404);
        }
        await role('admin');
        await request(server)
          .post('/api/fabric-catalog/manufacturers')
          .set('Cookie', cookie)
          .send({ name: 'Blocked' })
          .expect(403);
        await request(server)
          .post('/api/fabric-catalog/manufacturers')
          .set('Cookie', cookie)
          .set('Origin', 'https://untrusted.example')
          .send({ name: 'Blocked' })
          .expect(403);
      },
    );

    await t.test(
      'catalog CRUD validates input, returns hierarchy names, and enforces references',
      async () => {
        for (const route of routes) {
          await read(`${route}/not-a-uuid`).expect(400);
          await read(`${route}/${randomUUID()}`).expect(404);
          await patch(`${route}/${randomUUID()}`, {}).expect(400);
          await remove(`${route}/${randomUUID()}`).expect(404);
          await read(`${route}?page=0`).expect(400);
          await read(`${route}?pageSize=101`).expect(400);
          await post(route, { unexpected: true }).expect(400);
        }
        await post('manufacturers', { name: '   ' }).expect(400);
        await post('manufacturers', { name: 'a'.repeat(121) }).expect(400);
        const manufacturer = manufacturerSchema.parse(
          (await post('manufacturers', { name: '  Acme  ' }).expect(201)).body,
        );
        assert.equal(manufacturer.name, 'Acme');
        const second = manufacturerSchema.parse(
          (await post('manufacturers', { name: 'Other' }).expect(201)).body,
        );
        await patch(`manufacturers/${second.id}`, {
          name: 'Other updated',
        }).expect(200);
        await patch(`manufacturers/${randomUUID()}`, {
          name: 'Missing',
        }).expect(404);
        await post('materials', {
          name: 'Missing',
          manufacturerId: randomUUID(),
        }).expect(404);
        const material = fabricMaterialSchema.parse(
          (
            await post('materials', {
              name: ' Linen ',
              manufacturerId: manufacturer.id,
            }).expect(201)
          ).body,
        );
        assert.equal(material.manufacturerName, 'Acme');
        await patch(`materials/${material.id}`, {
          manufacturerId: randomUUID(),
        }).expect(404);
        await patch(`materials/${randomUUID()}`, {
          name: 'Missing',
        }).expect(404);
        const movedMaterial = fabricMaterialSchema.parse(
          (
            await patch(`materials/${material.id}`, {
              name: 'Linen updated',
              manufacturerId: second.id,
            }).expect(200)
          ).body,
        );
        assert.equal(movedMaterial.manufacturerName, 'Other updated');
        await patch(`materials/${material.id}`, {
          manufacturerId: manufacturer.id,
        }).expect(200);
        const payload = {
          code: ' ab-12 ',
          materialId: material.id,
          thicknessMm: 0.123,
        };
        for (const thicknessMm of [0, -1, 0.1234, 10000000, '0.123', null])
          await post('colors', { ...payload, thicknessMm }).expect(400);
        for (const code of ['', 'WITH SPACE', 'ABCDEFGHIJK', 'ABC_123'])
          await post('colors', { ...payload, code }).expect(400);
        await post('colors', {
          ...payload,
          materialId: randomUUID(),
        }).expect(404);
        const color = fabricColorSchema.parse(
          (await post('colors', payload).expect(201)).body,
        );
        assert.equal(color.code, 'AB-12');
        assert.equal(color.thicknessMm, 0.123);
        assert.equal(color.materialName, 'Linen updated');
        assert.equal(color.manufacturerName, 'Acme');
        await post('colors', { ...payload, code: 'AB-12' }).expect(409);
        await patch(`colors/${color.id}`, {
          materialId: randomUUID(),
        }).expect(404);
        await patch(`colors/${randomUUID()}`, {
          code: 'MISSING',
        }).expect(404);
        const color2 = fabricColorSchema.parse(
          (await post('colors', { ...payload, code: 'OTHER' }).expect(201))
            .body,
        );
        await patch(`colors/${color2.id}`, { code: ' ab-12 ' }).expect(409);
        const changed = fabricColorSchema.parse(
          (
            await patch(`colors/${color.id}`, {
              thicknessMm: 0.456,
            }).expect(200)
          ).body,
        );
        assert.equal(changed.thicknessMm, 0.456);
        assert.equal(changed.code, 'AB-12');
        const codeOnly = fabricColorSchema.parse(
          (await patch(`colors/${color.id}`, { code: 'ab-13' }).expect(200))
            .body,
        );
        assert.equal(codeOnly.thicknessMm, 0.456);
        assert.equal(codeOnly.code, 'AB-13');
        for (const [route, id] of [
          ['manufacturers', manufacturer.id],
          ['materials', material.id],
          ['colors', color.id],
        ]) {
          await read(`${route}/${id}`).expect(200);
        }
        await remove(`manufacturers/${manufacturer.id}`).expect(409);
        await remove(`materials/${material.id}`).expect(409);

        const filtered = fabricColorListSchema.parse(
          (
            await read(
              `colors?manufacturerId=${manufacturer.id}&materialId=${material.id}&search=ab-&pageSize=1`,
            ).expect(200)
          ).body,
        );
        assert.equal(filtered.total, 1);
        assert.equal(filtered.items[0]?.id, color.id);
        assert.equal(filtered.pageSize, 1);
        assert.equal(
          (await read(`colors?manufacturerId=${second.id}`).expect(200)).body
            .total,
          0,
        );
        const page2 = fabricColorListSchema.parse(
          (await read('colors?pageSize=1&page=2').expect(200)).body,
        );
        assert.equal(page2.total, 2);
        assert.equal(page2.items[0]?.id, color2.id);
        assert.equal(
          (
            await read(
              `materials?manufacturerId=${manufacturer.id}&search=linen`,
            ).expect(200)
          ).body.total,
          1,
        );
        assert.equal(
          (await read('manufacturers?search=acme').expect(200)).body.total,
          1,
        );
        assert.equal(
          (await read('manufacturers?search=%25').expect(200)).body.total,
          0,
        );
        assert.equal((await read('colors?search=_').expect(200)).body.total, 0);
        await read('colors?materialId=invalid').expect(400);

        // A role change takes effect on the existing session, without another login.
        await role('user');
        await patch(`colors/${color.id}`, { thicknessMm: 1 }).expect(403);
        await read(`colors/${color.id}`).expect(200);
        await role('admin');
        await remove(`colors/${color.id}`).expect(204);
        await read(`colors/${color.id}`).expect(404);
        await remove(`colors/${color2.id}`).expect(204);
        await remove(`materials/${material.id}`).expect(204);
        await remove(`manufacturers/${manufacturer.id}`).expect(204);
        await remove(`manufacturers/${second.id}`).expect(204);
      },
    );
  } finally {
    await role('user');
  }
}
