import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Pool } from 'pg';
import 'reflect-metadata';
import { DatabaseService } from '../database/database.service.js';
import { AuditService } from '../features/audit/index.js';
import { presentEmployee } from '../features/employees/testing/index.js';
import { startSignedInApp } from '../testing/integration-app.js';
import { UnitOfWork } from './unit-of-work.js';

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const employee = (name: string) => ({
  name,
  initials: 'UT',
  isActive: true,
  linkedUserId: null,
});

test('unit of work over PostgreSQL', { timeout: 60_000 }, async (t) => {
  const h = await startSignedInApp(t);
  const unitOfWork = h.app.get(UnitOfWork);
  const audit = h.app.get(AuditService);

  await t.test(
    'domain changes, audit changes and replay records roll back together',
    async () => {
      const key = randomUUID();
      let employeeId = '';
      let manufacturerId = '';
      let eventId = '';
      const failure = new Error('Failure after the replay record was written');
      await assert.rejects(
        unitOfWork.transaction(async (context) => {
          const row = await context.employees.create(employee('Rollback'));
          employeeId = row.id;
          manufacturerId = (
            await context.manufacturers.create({ name: randomUUID() })
          ).id;
          eventId = await audit.record(context, h.userId, 'employee.created', [
            {
              recordType: 'employees',
              recordId: row.id,
              before: null,
              after: { type: 'employees', value: presentEmployee(row) },
            },
          ]);
          await audit.remember(
            context,
            h.userId,
            'test.rollback',
            row.id,
            key,
            '0'.repeat(64),
            {
              eventId,
              recordId: row.id,
              revision: row.revision,
              affectedAllocationIds: [],
              createdStockItemIds: [],
            },
          );
          throw failure;
        }),
        (error) => error === failure,
      );
      for (const [table, column, value] of [
        ['employees', 'id', employeeId],
        ['manufacturers', 'id', manufacturerId],
        ['audit_events', 'id', eventId],
        ['audit_changes', 'event_id', eventId],
        ['correction_requests', 'key', key],
      ]) {
        assert.equal(
          (
            await h.pool.query(`SELECT * FROM ${table} WHERE ${column}=$1`, [
              value,
            ])
          ).rowCount,
          0,
          table,
        );
      }
      const committed = await unitOfWork.transaction((context) =>
        context.employees.create(employee('Committed')),
      );
      assert.equal(
        (
          await h.pool.query('SELECT * FROM employees WHERE id=$1', [
            committed.id,
          ])
        ).rowCount,
        1,
      );
    },
  );

  await t.test(
    'simultaneous units see their own writes and commit or roll back independently',
    async () => {
      const ready = signal(),
        done = signal();
      let firstId = '',
        secondId = '';
      const failure = new Error('Rollback only the second unit');
      const first = unitOfWork.transaction(async (context) => {
        firstId = (await context.employees.create(employee('First'))).id;
        ready.resolve();
        await done.promise;
        assert.ok(await context.employees.find(firstId));
        assert.equal(await context.employees.find(secondId), undefined);
      });
      // Attach a handler immediately so a failed first branch cannot become unhandled.
      const firstObserved = first.finally(ready.resolve);
      const second = (async () => {
        await ready.promise;
        await assert.rejects(
          unitOfWork.transaction(async (context) => {
            secondId = (await context.employees.create(employee('Second'))).id;
            assert.ok(await context.employees.find(secondId));
            assert.equal(await context.employees.find(firstId), undefined);
            throw failure;
          }),
          (error) => error === failure,
        );
      })().finally(done.resolve);
      await Promise.all([firstObserved, second]);
      assert.equal(
        (await h.pool.query('SELECT * FROM employees WHERE id=$1', [firstId]))
          .rowCount,
        1,
      );
      assert.equal(
        (await h.pool.query('SELECT * FROM employees WHERE id=$1', [secondId]))
          .rowCount,
        0,
      );
    },
  );

  await t.test(
    'read-only transactions hold a consistent snapshot and reject writes',
    async () => {
      const original = await unitOfWork.transaction((context) =>
        context.employees.create(employee('Before snapshot')),
      );
      await unitOfWork.readOnlyTransaction(async (context) => {
        assert.equal(
          (await context.employees.find(original.id))!.name,
          'Before snapshot',
        );
        await h.pool.query('UPDATE employees SET name=$1 WHERE id=$2', [
          'After snapshot',
          original.id,
        ]);
        assert.equal(
          (await context.employees.find(original.id))!.name,
          'Before snapshot',
        );
      });
      assert.equal(
        (await unitOfWork.readOnlyTransaction((context) =>
          context.employees.find(original.id),
        ))!.name,
        'After snapshot',
      );
      await assert.rejects(
        unitOfWork.readOnlyTransaction((context) =>
          context.employees.create(employee('Forbidden')),
        ),
        (error) => {
          const cause = (error as { cause?: { code?: string } }).cause;
          return cause?.code === '25006';
        },
      );
      assert.equal(
        (await h.pool.query("SELECT * FROM employees WHERE name='Forbidden'"))
          .rowCount,
        0,
      );
    },
  );

  await t.test(
    'timeout settings are local to the transaction and reset on a reused connection',
    async (st) => {
      const pool = new Pool({
        connectionString: h.config.DATABASE_URL,
        max: 1,
      });
      st.after(() => pool.end());
      const db = drizzle(pool);
      const isolated = new UnitOfWork({ db } as unknown as DatabaseService);
      const settings = sql`SELECT current_setting('lock_timeout') AS lock, current_setting('statement_timeout') AS statement`;
      const before = (await db.execute(settings)).rows[0];
      const original = db.transaction.bind(db);
      const observed: unknown[] = [];
      st.mock.method(
        db,
        'transaction',
        (
          operation: Parameters<typeof db.transaction>[0],
          config: Parameters<typeof db.transaction>[1],
        ) =>
          original(async (tx) => {
            try {
              return await operation(tx);
            } finally {
              observed.push((await tx.execute(settings)).rows[0]);
            }
          }, config),
      );
      await isolated.transaction(async (context) => {
        await context.employees.list();
      });
      await isolated.readOnlyTransaction(async (context) => {
        await context.employees.list();
      });
      await assert.rejects(
        isolated.transaction(async () => {
          throw new Error('rollback');
        }),
        /rollback/,
      );
      assert.deepEqual(
        observed,
        Array.from({ length: 3 }, () => ({ lock: '5s', statement: '30s' })),
      );
      assert.deepEqual((await db.execute(settings)).rows[0], before);
    },
  );
});
