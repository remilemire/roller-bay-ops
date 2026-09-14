import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'pg';
import request from 'supertest';
import {
  ownershipTransferResultSchema,
  userSchema,
} from '@roller-bay/shared/users';
import { UsersRepository } from './users.repository.js';
import { UsersService } from './users.service.js';
import type { MicrosoftProfileInput } from './microsoft-profile.schema.js';

type SignIn = () => Promise<{ authenticated: string }>;

export async function testUserRoles(
  t: TestContext,
  app: INestApplication,
  pool: Pool,
  schema: string,
  adminCookie: string,
  origin: string,
  setProfile: (profile: MicrosoftProfileInput) => void,
  signIn: SignIn,
  rejectedLogin: () => Promise<void>,
) {
  const server = app.getHttpServer();
  const post = (path: string, cookie: string, body?: object) => {
    const call = request(server)
      .post(`/api/users/${path}`)
      .set('Cookie', cookie)
      .set('Origin', origin);
    return body ? call.send(body) : call;
  };
  const setRole = (id: string, role: unknown, cookie = adminCookie) =>
    request(server)
      .patch(`/api/users/${id}/role`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send({ role });
  const activate = (id: string, isActive: boolean, cookie = adminCookie) =>
    request(server)
      .patch(`/api/users/${id}/activation`)
      .set('Cookie', cookie)
      .set('Origin', origin)
      .send({ isActive });
  const me = async (cookie: string) =>
    userSchema.parse(
      (
        await request(server)
          .get('/api/auth/me')
          .set('Cookie', cookie)
          .expect(200)
      ).body,
    );
  const ownerId = async () => {
    const { rows } = await pool.query(
      `SELECT id FROM "${schema}".users WHERE role='owner'`,
    );
    assert.equal(rows.length, 1);
    return rows[0].id as string;
  };
  const ownerProfile = {
    microsoftSubjectId: 'bootstrap-owner',
    name: 'Bootstrap Owner',
    email: ' OWNER@Example.COM ',
  };
  let ownerCookie = '';
  let originalOwnerId = '';
  let recipientCookie = '';
  let recipientId = '';
  let alternateId = '';

  await t.test(
    'bootstrap uses the normalized configured email and never activates a disabled account',
    async () => {
      assert.equal(
        (
          await pool.query(
            `SELECT count(*) FROM "${schema}".users WHERE role='owner'`,
          )
        ).rows[0].count,
        '0',
      );
      const { rows } = await pool.query(
        `INSERT INTO "${schema}".users (name,email,microsoft_subject_id,is_active) VALUES ($1,$2,$3,false) RETURNING id`,
        [
          ownerProfile.name,
          'owner@example.com',
          ownerProfile.microsoftSubjectId,
        ],
      );
      originalOwnerId = rows[0].id;
      setProfile(ownerProfile);
      await rejectedLogin();
      assert.equal(
        (await app.get(UsersService).findById(originalOwnerId))?.isActive,
        false,
      );
      assert.equal(
        (
          await pool.query(
            `SELECT count(*) FROM "${schema}".users WHERE role='owner'`,
          )
        ).rows[0].count,
        '0',
      );
      await activate(originalOwnerId, true).expect(200);
      const logins = await Promise.all([signIn(), signIn(), signIn()]);
      ownerCookie = logins[0]!.authenticated;
      for (const login of logins)
        assert.equal((await me(login.authenticated)).role, 'owner');
      assert.equal(await ownerId(), originalOwnerId);
      assert.equal((await me(ownerCookie)).email, 'owner@example.com');
    },
  );

  await t.test('the users table itself rejects a second owner', async () => {
    await assert.rejects(
      pool.query(
        `INSERT INTO "${schema}".users (name,email,microsoft_subject_id,role) VALUES ('Extra owner',$1,$2,'owner')`,
        [`${randomUUID()}@example.com`, randomUUID()],
      ),
      (error: unknown) => {
        assert.ok(
          typeof error === 'object' && error !== null && 'code' in error,
        );
        assert.equal(error.code, '23505');
        return true;
      },
    );
    assert.equal(await ownerId(), originalOwnerId);
  });

  await t.test(
    'admins and the owner can promote and demote non-owners, including other admins',
    async () => {
      setProfile({
        microsoftSubjectId: 'ownership-recipient',
        name: 'Recipient',
        email: 'recipient@example.com',
      });
      recipientCookie = (await signIn()).authenticated;
      recipientId = (await me(recipientCookie)).id;
      setProfile({
        microsoftSubjectId: 'ownership-alternate',
        name: 'Alternate',
        email: 'alternate@example.com',
      });
      const alternateCookie = (await signIn()).authenticated;
      alternateId = (await me(alternateCookie)).id;
      for (const role of ['admin', 'user']) {
        await request(server)
          .patch(`/api/users/${recipientId}/role`)
          .set('Origin', origin)
          .send({ role })
          .expect(401);
        await setRole(recipientId, role, alternateCookie).expect(403);
        await setRole('invalid', role).expect(400);
        await setRole(randomUUID(), role).expect(404);
        await setRole(originalOwnerId, role).expect(403);
        await setRole(originalOwnerId, role, ownerCookie).expect(403);
        await request(server)
          .patch(`/api/users/${recipientId}/role`)
          .set('Cookie', adminCookie)
          .send({ role })
          .expect(403);
      }
      for (const body of [
        {},
        { role: 'owner' },
        { role: 'ADMIN' },
        { role: null },
        { role: 1 },
        { role: 'admin', isActive: true },
      ]) {
        await request(server)
          .patch(`/api/users/${recipientId}/role`)
          .set('Cookie', adminCookie)
          .set('Origin', origin)
          .send(body)
          .expect(400);
      }
      for (const action of ['promote', 'demote'])
        await post(`${recipientId}/${action}`, adminCookie).expect(404);
      assert.equal(
        (await setRole(recipientId, 'admin', adminCookie).expect(200)).body
          .role,
        'admin',
      );
      await setRole(recipientId, 'admin', adminCookie).expect(200);
      assert.equal((await me(recipientCookie)).role, 'admin');
      assert.equal(
        (await setRole(recipientId, 'user', adminCookie).expect(200)).body.role,
        'user',
      );
      await setRole(recipientId, 'user', adminCookie).expect(200);
      await setRole(alternateId, 'admin', ownerCookie).expect(200);
      // Administrators may demote themselves; the same session then loses its privileges.
      await setRole(alternateId, 'user', alternateCookie).expect(200);
      await setRole(recipientId, 'admin', alternateCookie).expect(403);
      await setRole(recipientId, 'admin', ownerCookie).expect(200);
      await setRole(recipientId, 'user', ownerCookie).expect(200);
      await activate(originalOwnerId, false).expect(403);
      await activate(originalOwnerId, false, ownerCookie).expect(403);
      await activate(recipientId, false, ownerCookie).expect(200);
      await activate(recipientId, true, ownerCookie).expect(200);
      const manufacturer = (
        await request(server)
          .post('/api/fabric-catalog/manufacturers')
          .set('Cookie', ownerCookie)
          .set('Origin', origin)
          .send({ name: 'Owner permission test' })
          .expect(201)
      ).body;
      await request(server)
        .delete(`/api/fabric-catalog/manufacturers/${manufacturer.id}`)
        .set('Cookie', ownerCookie)
        .set('Origin', origin)
        .expect(204);
    },
  );

  await t.test(
    'ownership transfer is owner-only, requires an active recipient, and rolls back on failure',
    async () => {
      for (const cookie of [adminCookie, recipientCookie])
        await post('transfer-ownership', cookie, {
          newOwnerId: recipientId,
        }).expect(403);
      await request(server)
        .post('/api/users/transfer-ownership')
        .set('Origin', origin)
        .send({ newOwnerId: recipientId })
        .expect(401);
      for (const body of [
        {},
        { newOwnerId: 'invalid' },
        { newOwnerId: recipientId, role: 'owner' },
      ])
        await post('transfer-ownership', ownerCookie, body).expect(400);
      await post('transfer-ownership', ownerCookie, {
        newOwnerId: originalOwnerId,
      }).expect(409);
      await post('transfer-ownership', ownerCookie, {
        newOwnerId: randomUUID(),
      }).expect(404);
      await activate(recipientId, false).expect(200);
      await post('transfer-ownership', ownerCookie, {
        newOwnerId: recipientId,
      }).expect(409);
      assert.equal(await ownerId(), originalOwnerId);
      await activate(recipientId, true).expect(200);
      const originalSetRole = UsersRepository.prototype.setRole;
      let sawUncommittedDemotion = false;
      const failingUpdate = t.mock.method(
        UsersRepository.prototype,
        'setRole',
        async function (
          this: UsersRepository,
          id: string,
          role: Parameters<UsersRepository['setRole']>[1],
        ) {
          if (id === recipientId && role === 'owner') {
            // This read must see the service's first update on the same transaction.
            assert.equal((await this.findById(originalOwnerId))?.role, 'admin');
            sawUncommittedDemotion = true;
            throw new Error('Simulated recipient update failure');
          }
          return originalSetRole.call(this, id, role);
        },
      );
      try {
        await post('transfer-ownership', ownerCookie, {
          newOwnerId: recipientId,
        }).expect(503);
        assert.equal(sawUncommittedDemotion, true);
      } finally {
        failingUpdate.mock.restore();
      }
      assert.equal(await ownerId(), originalOwnerId);
      assert.equal(
        (await app.get(UsersService).findById(recipientId))?.role,
        'user',
      );
      const transferred = ownershipTransferResultSchema.parse(
        (
          await post('transfer-ownership', ownerCookie, {
            newOwnerId: recipientId,
          }).expect(200)
        ).body,
      );
      assert.equal(transferred.previousOwner.id, originalOwnerId);
      assert.equal(transferred.previousOwner.role, 'admin');
      assert.equal(transferred.newOwner.id, recipientId);
      assert.equal(transferred.newOwner.role, 'owner');
      assert.equal(await ownerId(), recipientId);
      assert.equal((await me(ownerCookie)).role, 'admin');
      assert.equal((await me(recipientCookie)).role, 'owner');
      await post('transfer-ownership', ownerCookie, {
        newOwnerId: alternateId,
      }).expect(403);
      setProfile(ownerProfile);
      assert.equal((await me((await signIn()).authenticated)).role, 'admin');
      assert.equal(await ownerId(), recipientId);
    },
  );

  await t.test(
    'administrative lock waits time out and release the transaction',
    { timeout: 15000 },
    async () => {
      const blocker = await pool.connect();
      try {
        await blocker.query('BEGIN');
        await blocker.query(
          `LOCK TABLE "${schema}".users IN ROW EXCLUSIVE MODE`,
        );
        await setRole(alternateId, 'admin', recipientCookie).expect(503);
      } finally {
        await blocker.query('ROLLBACK');
        blocker.release();
      }
      assert.equal(await ownerId(), recipientId);
      await setRole(alternateId, 'admin', recipientCookie).expect(200);
    },
  );

  await t.test(
    'concurrent transfers have one winner and recheck ownership inside the transaction',
    async () => {
      const results = await Promise.all([
        post('transfer-ownership', recipientCookie, {
          newOwnerId: originalOwnerId,
        }),
        post('transfer-ownership', recipientCookie, {
          newOwnerId: alternateId,
        }),
      ]);
      assert.deepEqual(
        results.map((result) => result.status).sort(),
        [200, 403],
      );
      const winner = results.find((result) => result.status === 200)!;
      const result = ownershipTransferResultSchema.parse(winner.body);
      assert.equal(await ownerId(), result.newOwner.id);
      assert.equal(
        (await app.get(UsersService).findById(recipientId))?.role,
        'admin',
      );
      // A request that passed the guard earlier must not retain a stale role.
      await assert.rejects(
        app.get(UsersService).transferOwnership(recipientId, originalOwnerId),
        (error: unknown) => {
          assert.ok(
            error instanceof Error &&
              'getStatus' in error &&
              typeof error.getStatus === 'function',
          );
          assert.equal(error.getStatus(), 403);
          return true;
        },
      );
    },
  );
}
