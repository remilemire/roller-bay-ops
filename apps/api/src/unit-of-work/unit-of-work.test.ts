import { drizzle } from 'drizzle-orm/node-postgres';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, type TestContext } from 'node:test';
import { Pool } from 'pg';
import 'reflect-metadata';
import { DatabaseService } from '../database/database.service.js';
import { UnitOfWork } from './unit-of-work.js';

function recordingDatabase(t: TestContext, commitFailure?: Error) {
  const connections: { queries: string[]; released: boolean }[] = [];
  const pool = new Pool();
  t.after(() => pool.end());
  t.mock.method(pool, 'query', async () => {
    throw new Error('A repository escaped to the pool.');
  });
  t.mock.method(pool, 'connect', async () => {
    const connection = { queries: [] as string[], released: false };
    connections.push(connection);
    return {
      query: async (query: string | { text: string }) => {
        const text = typeof query === 'string' ? query : query.text;
        connection.queries.push(text);
        if (text === 'commit' && commitFailure) throw commitFailure;
        return { rows: [] };
      },
      release: () => {
        connection.released = true;
      },
    } as never;
  });
  return {
    unitOfWork: new UnitOfWork({ db: drizzle(pool) } as DatabaseService),
    connections,
  };
}

test('every context repository uses the transaction connection, with no pool fallback', async (t) => {
  const { unitOfWork, connections } = recordingDatabase(t);
  const id = randomUUID();
  const result = await unitOfWork.transaction(async (context) => {
    assert.equal(connections.length, 1);
    assert.equal(
      connections[0]!.queries.filter((q) =>
        /select|insert|update|delete/i.test(q),
      ).length,
      0,
    );
    const reads = {
      allocations: () => context.allocations.findById(id),
      stockItems: () => context.stockItems.findById(id),
      stockReceipts: () => context.stockReceipts.findById(id),
      workOrders: () => context.workOrders.findById(id),
      cuttingWorksheets: () => context.cuttingWorksheets.find(id),
      production: () => context.production.completions(id),
      audit: () => context.audit.findActor(id),
      users: () => context.users.findById(id),
      employees: () => context.employees.find(id),
      manufacturers: () => context.manufacturers.findById(id),
      fabricMaterials: () => context.fabricMaterials.findById(id),
      fabricColors: () => context.fabricColors.findById(id),
      locationZones: () => context.locationZones.findById(id),
      locationSections: () => context.locationSections.findById(id),
      locationLevels: () => context.locationLevels.findById(id),
      locationOrder: () => context.locationOrder.lockSiblings('zones', id),
    };
    assert.deepEqual(Object.keys(context).sort(), Object.keys(reads).sort());
    for (const read of Object.values(reads)) {
      const before = connections[0]!.queries.length;
      await read();
      assert.ok(connections[0]!.queries.length > before);
    }
    assert.equal(connections[0]!.released, false);
    return 'committed';
  });
  assert.equal(result, 'committed');
  assert.match(connections[0]!.queries[0]!, /read committed.*read write/);
  assert.ok(connections[0]!.queries.includes("SET LOCAL lock_timeout = '5s'"));
  assert.ok(
    connections[0]!.queries.includes("SET LOCAL statement_timeout = '30s'"),
  );
  assert.equal(connections[0]!.queries.at(-1), 'commit');
  assert.equal(connections[0]!.released, true);
});

test('callback and commit failures reject, roll back, and release the connection', async (t) => {
  for (const failAtCommit of [false, true]) {
    const failure = new Error(
      failAtCommit ? 'commit failed' : 'workflow failed',
    );
    const { unitOfWork, connections } = recordingDatabase(
      t,
      failAtCommit ? failure : undefined,
    );
    await assert.rejects(
      unitOfWork.transaction(async () => {
        if (!failAtCommit) throw failure;
        return 'must not be returned';
      }),
      (error) => error === failure || (error as Error).cause === failure,
    );
    assert.equal(connections[0]!.queries.at(-1), 'rollback');
    assert.equal(connections[0]!.released, true);
  }
});

test('read snapshots request repeatable read and independent contexts', async (t) => {
  const { unitOfWork, connections } = recordingDatabase(t);
  await unitOfWork.readOnlyTransaction(async (first) => {
    // An explicitly started second unit is independent; callers compose by passing first.
    await unitOfWork.readOnlyTransaction(async (second) => {
      for (const key of Object.keys(first) as (keyof typeof first)[]) {
        assert.notEqual(first[key], second[key]);
      }
      await second.users.findById(randomUUID());
    });
    await first.users.findById(randomUUID());
  });
  assert.equal(connections.length, 2);
  for (const connection of connections) {
    assert.match(connection.queries[0]!, /repeatable read.*read only/);
    assert.equal(connection.queries.at(-1), 'commit');
    assert.equal(connection.released, true);
  }
});
