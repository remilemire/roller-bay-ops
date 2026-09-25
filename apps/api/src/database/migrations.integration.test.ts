import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { Pool, type PoolClient } from 'pg';
import { testDatabaseUrl } from '../testing/test-services.js';
import {
  createTestDatabase,
  endPool,
  migrationsFolder,
} from './testing/test-database.js';

/**
 * Every other suite starts from an empty, fully migrated database, so nothing
 * there runs a migration over rows. This one stops before a migration that
 * moves data, seeds rows as they were, and applies it.
 */
const files = readdirSync(migrationsFolder)
  .filter((name) => name.endsWith('.sql'))
  .sort();
async function apply(client: PoolClient, name: string) {
  for (const statement of readFileSync(join(migrationsFolder, name), 'utf8')
    .split('--> statement-breakpoint')
    .filter((part) => part.trim()))
    await client.query(statement);
}
/** A database migrated up to, but not including, the migration under test. */
async function databaseBefore(t: TestContext, prefix: string) {
  const database = await createTestDatabase(testDatabaseUrl, {
    migrated: false,
  });
  const pool = new Pool({
    connectionString: database.url,
    max: 1,
    idleTimeoutMillis: 0,
  });
  const client = await pool.connect();
  // In this order: the pool waits for its client, the drop for the pool.
  t.after(async () => {
    client.release();
    await endPool(pool);
    await database.drop();
  });
  const target = files.findIndex((name) => name.startsWith(prefix));
  for (const name of files.slice(0, target)) await apply(client, name);
  return {
    client,
    /** Applies the migration under test as Drizzle does, in a transaction. */
    async migrate() {
      await client.query('BEGIN');
      try {
        await apply(client, files[target]!);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    },
    async migrateRest() {
      for (const name of files.slice(target + 1)) await apply(client, name);
    },
  };
}

test(
  '0037 gives each allocation its own blinds, and stops on blinds that nothing plans',
  { timeout: 60_000 },
  async (t) => {
    const { client, migrate, migrateRest } = await databaseBefore(t, '0037_');
    const id = () => randomUUID();
    const [user, maker, material, color] = [id(), id(), id(), id()];
    const [zone, section, location, stock] = [id(), id(), id(), id()];
    await client.query(
      `INSERT INTO users (id,name,email,microsoft_subject_id) VALUES ($1,'A','a@example.com','a')`,
      [user],
    );
    await client.query(`INSERT INTO manufacturers (id,name) VALUES ($1,'M')`, [
      maker,
    ]);
    await client.query(
      `INSERT INTO fabric_materials (id,manufacturer_id,name) VALUES ($1,$2,'M')`,
      [material, maker],
    );
    await client.query(
      `INSERT INTO fabric_colors (id,material_id,code,thickness_mm) VALUES ($1,$2,'C',0.5)`,
      [color, material],
    );
    await client.query(`INSERT INTO location_zones (id,name) VALUES ($1,'Z')`, [
      zone,
    ]);
    await client.query(
      `INSERT INTO location_sections (id,zone_id,label) VALUES ($1,$2,'A')`,
      [section, zone],
    );
    await client.query(
      `INSERT INTO locations (id,section_id,label) VALUES ($1,$2,'1')`,
      [location, section],
    );
    await client.query(
      `INSERT INTO fabric_stock_items (id,fabric_color_id,width_mm,initial_length_mm,location_id)
         VALUES ($1,$2,1200,10000,$3)`,
      [stock, color, location],
    );
    // Rows as they were before 0037: the order held its blinds. Its current
    // blind is planned by the live allocation and a draft; the retired one
    // by a cancelled allocation, and still by the draft, whose reads had
    // already left that assignment out.
    const [order, orphaned, current, retired] = [id(), id(), id(), id()];
    await client.query(
      `INSERT INTO work_orders (id,order_number,quantity,allocated_at)
         VALUES ($1,'370001',2,now()),($2,'370002',1,NULL)`,
      [order, orphaned],
    );
    await client.query(
      `INSERT INTO work_order_lines (id,work_order_id,position,fabric_color_id,width_mm,length_mm,quantity,retired_at)
         VALUES ($1,$3,1,$4,500,1000,2,NULL),($2,$3,2,$4,600,1100,1,now())`,
      [current, retired, order, color],
    );
    const settings = {
      edgeTrimMm: 1,
      minimumRemnantWidthMm: 100,
      minimumRemnantLengthMm: 100,
      dropAllowanceMm: 254,
    };
    /** An allocation whose one cut assigns the given lines. */
    const allocation = async (
      state: 'draft' | 'live' | 'cancelled',
      lines: string[],
    ) => {
      const [self, item, cut] = [id(), id(), id()];
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO allocations (id,is_draft,work_order_id,created_by_user_id,confirmed_at,cancelled_at,settings)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          self,
          state === 'draft',
          order,
          user,
          state === 'draft' ? null : new Date(),
          state === 'cancelled' ? new Date() : null,
          state === 'draft' ? null : settings,
        ],
      );
      await client.query(
        `INSERT INTO allocation_items (id,allocation_id,stock_item_id,reserved_length_mm) VALUES ($1,$2,$3,$4)`,
        [item, self, stock, state === 'draft' ? null : 1354],
      );
      await client.query(
        `INSERT INTO allocation_cuts (id,allocation_item_id,plan_position,position,planned_length_mm,edge_trim_mm)
           VALUES ($1,$2,1,1,1354,1)`,
        [cut, item],
      );
      for (const [index, line] of lines.entries())
        await client.query(
          `INSERT INTO allocation_cut_items (allocation_cut_id,work_order_line_id,position,quantity) VALUES ($1,$2,$3,1)`,
          [cut, line, index + 1],
        );
      await client.query('COMMIT');
      return self;
    };
    const cancelled = await allocation('cancelled', [retired]);
    const live = await allocation('live', [current]);
    const draft = await allocation('draft', [current, retired]);

    // A current blind that nothing would take stops the migration.
    const stray = id();
    await client.query(
      `INSERT INTO work_order_lines (id,work_order_id,position,fabric_color_id,width_mm,length_mm,quantity)
         VALUES ($1,$2,1,$3,500,1000,1)`,
      [stray, orphaned, color],
    );
    await assert.rejects(
      migrate(),
      /1 blind\(s\) are on an order with no draft/,
    );
    await client.query(`DELETE FROM work_order_lines WHERE id=$1`, [stray]);
    await migrate();

    const requirements = async (allocationId: string) =>
      (
        await client.query(
          `SELECT id, position, width_mm, quantity FROM allocation_requirements WHERE allocation_id=$1 ORDER BY position`,
          [allocationId],
        )
      ).rows;
    const assigned = async (allocationId: string) =>
      (
        await client.query(
          `SELECT ci.allocation_requirement_id AS id FROM allocation_cut_items ci
             JOIN allocation_cuts c ON c.id = ci.allocation_cut_id
             JOIN allocation_items i ON i.id = c.allocation_item_id
             WHERE i.allocation_id=$1 ORDER BY ci.position`,
          [allocationId],
        )
      ).rows.map((row) => row.id);
    // The live allocation keeps the current blind's id, the cancelled one
    // the retired blind's, and the draft a copy of the current blind.
    assert.deepEqual(await requirements(live), [
      { id: current, position: 1, width_mm: '500.000', quantity: 2 },
    ]);
    assert.deepEqual(await assigned(live), [current]);
    assert.deepEqual(await requirements(cancelled), [
      { id: retired, position: 1, width_mm: '600.000', quantity: 1 },
    ]);
    assert.deepEqual(await assigned(cancelled), [retired]);
    const [copy] = await requirements(draft);
    assert.notEqual(copy.id, current);
    assert.deepEqual({ ...copy, id: current }, (await requirements(live))[0]);
    assert.deepEqual(await assigned(draft), [copy.id]);
    assert.equal(
      (
        await client.query(
          `SELECT to_regclass('public.work_order_lines') AS lines`,
        )
      ).rows[0].lines,
      null,
    );

    // A confirmed allocation needs complete blinds; a draft does not.
    await client.query(
      `UPDATE allocation_requirements SET quantity=NULL WHERE allocation_id=$1`,
      [draft],
    );
    await assert.rejects(
      client.query(
        `UPDATE allocation_requirements SET quantity=NULL WHERE allocation_id=$1`,
        [live],
      ),
      { code: '23514', constraint: 'allocations_confirmed_fields_required' },
    );
    await migrateRest();
  },
);

test(
  "0036 gives each order its current blinds' total, or a placeholder of 1",
  { timeout: 60_000 },
  async (t) => {
    const { client, migrate, migrateRest } = await databaseBefore(t, '0036_');
    const [manufacturer, material, color] = [
      randomUUID(),
      randomUUID(),
      randomUUID(),
    ];
    await client.query(`INSERT INTO manufacturers (id,name) VALUES ($1,'M')`, [
      manufacturer,
    ]);
    await client.query(
      `INSERT INTO fabric_materials (id,manufacturer_id,name) VALUES ($1,$2,'M')`,
      [material, manufacturer],
    );
    await client.query(
      `INSERT INTO fabric_colors (id,material_id,code,thickness_mm) VALUES ($1,$2,'C',0.5)`,
      [color, material],
    );
    const [blinds, none] = [randomUUID(), randomUUID()];
    await client.query(
      `INSERT INTO work_orders (id,order_number) VALUES ($1,'360001'),($2,'360002')`,
      [blinds, none],
    );
    // Two current blinds and a retired one, which no longer counts.
    for (const [position, quantity, retired] of [
      [1, 3, false],
      [2, 2, false],
      [3, 7, true],
    ] as const)
      await client.query(
        `INSERT INTO work_order_lines (id,work_order_id,position,fabric_color_id,width_mm,length_mm,quantity,retired_at)
         VALUES ($1,$2,$3,$4,1000,1500,$5,$6)`,
        [
          randomUUID(),
          blinds,
          position,
          color,
          quantity,
          retired ? new Date() : null,
        ],
      );
    await migrate();
    const quantities = await client.query(
      `SELECT order_number, quantity FROM work_orders ORDER BY order_number`,
    );
    assert.deepEqual(quantities.rows, [
      { order_number: '360001', quantity: 5 },
      { order_number: '360002', quantity: 1 },
    ]);
    // New orders must state theirs, and it is positive.
    await assert.rejects(
      client.query(`INSERT INTO work_orders (order_number) VALUES ('360003')`),
      { code: '23502' },
    );
    await assert.rejects(
      client.query(
        `INSERT INTO work_orders (order_number,quantity) VALUES ('360003',0)`,
      ),
      { code: '23514' },
    );
    // 0037 moves blinds to the allocations that plan them; these have none.
    await client.query(`DELETE FROM work_order_lines`);
    await migrateRest();
  },
);

test(
  '0035 moves each credited employee to its own row and drops the single columns',
  { timeout: 60_000 },
  async (t) => {
    const { client, migrate, migrateRest } = await databaseBefore(t, '0035_');
    const [user, employee, order] = Array.from({ length: 3 }, () =>
      randomUUID(),
    );
    await client.query(
      `INSERT INTO users (id,name,email,microsoft_subject_id)
       VALUES ($1,'Checker','checker@example.com','checker')`,
      [user],
    );
    await client.query(
      `INSERT INTO employees (id,name,initials) VALUES ($1,'Checker','CK')`,
      [employee],
    );
    await client.query(
      `INSERT INTO work_orders (id,order_number,allocated_at,checked_at)
       VALUES ($1,'350001',now(),now())`,
      [order],
    );
    await client.query(
      `INSERT INTO production_completions (work_order_id,station,employee_id,employee_name,employee_initials,completed_at,recorded_by_user_id)
       VALUES ($1,'checking',$2,'Checker at the time','CT',now(),$3)`,
      [order, employee, user],
    );
    await migrate();
    const columns = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='production_completions'`,
    );
    assert.ok(
      !columns.rows.some((r) => String(r.column_name).startsWith('employee_')),
    );
    const credited = await client.query(
      `SELECT employee_id,employee_name,employee_initials FROM production_completion_employees WHERE work_order_id=$1 AND station='checking'`,
      [order],
    );
    assert.deepEqual(credited.rows, [
      {
        employee_id: employee,
        employee_name: 'Checker at the time',
        employee_initials: 'CT',
      },
    ]);
    await assert.rejects(
      client.query(
        `INSERT INTO production_completion_employees (work_order_id,station,employee_id,employee_name,employee_initials)
         VALUES ($1,'checking',$2,'Nobody','NB')`,
        [order, randomUUID()],
      ),
      { code: '23503' },
    );
    await client.query(
      `DELETE FROM production_completions WHERE work_order_id=$1`,
      [order],
    );
    assert.equal(
      (
        await client.query(
          `SELECT count(*)::int AS n FROM production_completion_employees WHERE work_order_id=$1`,
          [order],
        )
      ).rows[0].n,
      0,
    );
    await migrateRest();
  },
);

test(
  '0034 preserves scheduled dates when fabric is released',
  { timeout: 60_000 },
  async (t) => {
    const { client, migrate } = await databaseBefore(t, '0034_');
    const seeded =
      await client.query(`INSERT INTO work_orders (order_number, ship_date, scheduled_at, allocated_at)
    VALUES ('340001','2026-10-02',now(),now()) RETURNING *`);
    const before = seeded.rows[0];
    await migrate();
    assert.deepEqual(
      (await client.query('SELECT * FROM work_orders WHERE id=$1', [before.id]))
        .rows[0],
      before,
    );
    const released = (
      await client.query(
        'UPDATE work_orders SET allocated_at=NULL WHERE id=$1 RETURNING *',
        [before.id],
      )
    ).rows[0];
    assert.deepEqual(released.ship_date, before.ship_date);
    assert.deepEqual(released.scheduled_at, before.scheduled_at);
    await assert.rejects(
      client.query(
        "UPDATE work_orders SET cancelled_at=now(),cancellation_reason='stop' WHERE id=$1",
        [before.id],
      ),
      { code: '23514' },
    );
  },
);

test(
  '0033 preserves existing production and permits explicit release and cancellation',
  { timeout: 60_000 },
  async (t) => {
    const { client, migrate } = await databaseBefore(t, '0033_');
    const [user, employee, order, allocation, worksheet] = Array.from(
      { length: 5 },
      () => randomUUID(),
    );
    await client.query(
      `INSERT INTO users (id,name,email,microsoft_subject_id)
       VALUES ($1,'Cutter','cutter@example.com','cutter')`,
      [user],
    );
    await client.query(
      `INSERT INTO employees (id,name,initials) VALUES ($1,'Cutter','C')`,
      [employee],
    );
    await client.query(
      `INSERT INTO work_orders (id,order_number,allocated_at,cut_at)
       VALUES ($1,'330001',now(),now())`,
      [order],
    );
    const settings = {
      edgeTrimMm: 1,
      minimumRemnantWidthMm: 100,
      minimumRemnantLengthMm: 100,
      dropAllowanceMm: 254,
    };
    await client.query(
      `INSERT INTO allocations (id,work_order_id,created_by_user_id,is_draft,confirmed_at,completed_at,settings,completion)
       VALUES ($1,$2,$3,false,now(),now(),$4,'{"items":[]}')`,
      [allocation, order, user, settings],
    );
    await client.query(
      `INSERT INTO cutting_worksheets (id,allocation_id,work_order_id,order_number,employee_id,employee_name,employee_initials,started_by_user_id,snapshot,baselines)
       VALUES ($1,$2,$3,'330001',$4,'Cutter','C',$5,'{}','{}')`,
      [worksheet, allocation, order, employee, user],
    );
    const snapshot = async () => {
      const rows = await client.query(`
        SELECT to_jsonb(o) - ARRAY['cancelled_at','cancellation_reason'] AS data FROM work_orders o
        UNION ALL SELECT to_jsonb(a) - 'released_at' FROM allocations a
        UNION ALL SELECT to_jsonb(w) - 'skipped_at' FROM cutting_worksheets w`);
      return rows.rows;
    };
    const before = await snapshot();
    await migrate();
    assert.deepEqual(await snapshot(), before);

    // The replacement index still prevents a second live plan until release.
    const anotherPlan = () =>
      client.query(
        `INSERT INTO allocations (work_order_id,created_by_user_id,is_draft,confirmed_at,settings)
       VALUES ($1,$2,false,now(),$3) RETURNING id`,
        [order, user, settings],
      );
    await assert.rejects(anotherPlan(), { code: '23505' });
    await client.query('UPDATE allocations SET released_at=now() WHERE id=$1', [
      allocation,
    ]);
    const replacement = (await anotherPlan()).rows[0].id;
    await assert.rejects(
      client.query('UPDATE allocations SET released_at=now() WHERE id=$1', [
        replacement,
      ]),
      { code: '23514' },
    );
    await client.query(
      'UPDATE allocations SET cancelled_at=now() WHERE id=$1',
      [replacement],
    );
    await assert.rejects(
      client.query(
        'UPDATE work_orders SET cancelled_at=now(),allocated_at=NULL WHERE id=$1',
        [order],
      ),
      { code: '23514' },
    );
    const cancelled = await client.query(
      `UPDATE work_orders SET cancelled_at=now(),allocated_at=NULL,cancellation_reason='Customer cancelled'
       WHERE id=$1 RETURNING cut_at`,
      [order],
    );
    assert.ok(cancelled.rows[0].cut_at);
    await client.query(
      'UPDATE cutting_worksheets SET skipped_at=now() WHERE id=$1',
      [worksheet],
    );
    await assert.rejects(
      client.query(
        'UPDATE cutting_worksheets SET submitted_at=now(),reviewed_at=now() WHERE id=$1',
        [worksheet],
      ),
      { code: '23514' },
    );
  },
);

test(
  '0032 preserves existing access while making new accounts pending',
  { timeout: 60_000 },
  async (t) => {
    const { client, migrate } = await databaseBefore(t, '0032_');
    for (const [subject, role] of [
      ['production-account', 'station'],
      ['staff-account', 'user'],
      ['admin-account', 'admin'],
      ['owner-account', 'owner'],
    ] as const)
      await client.query(
        `INSERT INTO users (name,email,microsoft_subject_id,role)
           VALUES ($1,$2,$3,$4)`,
        [subject, `${subject}@example.com`, subject, role],
      );
    await client.query(
      `INSERT INTO users (name,email,microsoft_subject_id)
         VALUES ('default-account','default@example.com','default-account')`,
    );

    await migrate();

    const roles = await client.query(
      `SELECT microsoft_subject_id, role::text FROM users ORDER BY microsoft_subject_id`,
    );
    assert.deepEqual(roles.rows, [
      { microsoft_subject_id: 'admin-account', role: 'admin' },
      { microsoft_subject_id: 'default-account', role: 'staff' },
      { microsoft_subject_id: 'owner-account', role: 'owner' },
      { microsoft_subject_id: 'production-account', role: 'production' },
      { microsoft_subject_id: 'staff-account', role: 'staff' },
    ]);
    const pending = await client.query(
      `INSERT INTO users (name,email,microsoft_subject_id)
         VALUES ('Pending','pending@example.com','pending-account') RETURNING role::text`,
    );
    assert.equal(pending.rows[0].role, 'pending');
    await assert.rejects(
      client.query(
        `INSERT INTO users (name,email,microsoft_subject_id,role)
           VALUES ('Owner 2','owner2@example.com','owner-2','owner')`,
      ),
      (error: unknown) => {
        assert.ok(
          typeof error === 'object' && error !== null && 'code' in error,
        );
        assert.equal(error.code, '23505');
        return true;
      },
    );
  },
);

test(
  '0028 moves blinds from allocations to their work orders, or stops',
  { timeout: 60_000 },
  async (t) => {
    const { client, migrate, migrateRest } = await databaseBefore(t, '0028_');

    // Rows as they were before 0028: an allocation named its order by number
    // and owned a copy of the blinds, each with its own drop allowance.
    const id = () => randomUUID();
    const [user, maker, material, color] = [id(), id(), id(), id()];
    const [zone, section, location, stock] = [id(), id(), id(), id()];
    await client.query(
      `INSERT INTO users (id,name,email,microsoft_subject_id) VALUES ($1,'A','a@example.com','a')`,
      [user],
    );
    await client.query(`INSERT INTO manufacturers (id,name) VALUES ($1,'M')`, [
      maker,
    ]);
    await client.query(
      `INSERT INTO fabric_materials (id,manufacturer_id,name) VALUES ($1,$2,'M')`,
      [material, maker],
    );
    await client.query(
      `INSERT INTO fabric_colors (id,material_id,code,thickness_mm) VALUES ($1,$2,'C',0.5)`,
      [color, material],
    );
    await client.query(`INSERT INTO location_zones (id,name) VALUES ($1,'Z')`, [
      zone,
    ]);
    await client.query(
      `INSERT INTO location_sections (id,zone_id,label) VALUES ($1,$2,'A')`,
      [section, zone],
    );
    await client.query(
      `INSERT INTO locations (id,section_id,label) VALUES ($1,$2,'1')`,
      [location, section],
    );
    await client.query(
      `INSERT INTO fabric_stock_items (id,fabric_color_id,width_mm,initial_length_mm,location_id)
         VALUES ($1,$2,1200,10000,$3)`,
      [stock, color, location],
    );
    await client.query(
      `INSERT INTO work_orders (order_number, quantity, allocated_at) VALUES ('500001', 1, now()), ('500002', 1, NULL)`,
    );
    const settings = {
      edgeTrimMm: 1,
      minimumRemnantWidthMm: 100,
      minimumRemnantLengthMm: 100,
    };
    /** One allocation of one blind, 600 wide, cut from the one roll. */
    const allocation = async (
      orderNumber: string | null,
      state: 'draft' | 'live' | 'cancelled',
      at: string,
      allowance = '254',
    ) => {
      const [self, requirement, item, cut] = [id(), id(), id(), id()];
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO allocations (id,is_draft,order_number,created_by_user_id,confirmed_at,cancelled_at,settings,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          self,
          state === 'draft',
          orderNumber,
          user,
          state === 'draft' ? null : at,
          state === 'cancelled' ? at : null,
          state === 'draft' ? null : settings,
          at,
        ],
      );
      await client.query(
        `INSERT INTO allocation_requirements (id,allocation_id,position,fabric_color_id,width_mm,length_mm,length_allowance_mm,quantity)
           VALUES ($1,$2,1,$3,600,1000,$4,1)`,
        [requirement, self, color, allowance],
      );
      await client.query(
        `INSERT INTO allocation_items (id,allocation_id,stock_item_id,reserved_length_mm) VALUES ($1,$2,$3,1254)`,
        [item, self, stock],
      );
      await client.query(
        `INSERT INTO allocation_cuts (id,allocation_item_id,plan_position,position,planned_length_mm,edge_trim_mm)
           VALUES ($1,$2,1,1,1254,1)`,
        [cut, item],
      );
      await client.query(
        `INSERT INTO allocation_cut_items (allocation_cut_id,allocation_requirement_id,position,quantity) VALUES ($1,$2,1,1)`,
        [cut, requirement],
      );
      await client.query('COMMIT');
      return { id: self, requirement, cut };
    };
    const cancelled = await allocation('500001', 'cancelled', '2026-09-01');
    const live = await allocation('500001', 'live', '2026-09-02');
    const shadowed = await allocation('500001', 'draft', '2026-09-03');
    const older = await allocation('500002', 'draft', '2026-09-04');
    const newer = await allocation('500002', 'draft', '2026-09-05');

    /** A row the migration cannot place stops it, and removing the row lets it on. */
    const stops = async (message: RegExp, add: string, remove: string) => {
      await client.query(add);
      await assert.rejects(migrate(), message);
      // Nothing changed: the table the blinds would leave is still there.
      assert.equal(
        (
          await client.query(
            `SELECT to_regclass('allocation_requirements') IS NOT NULL AS kept`,
          )
        ).rows[0].kept,
        true,
      );
      await client.query(remove);
    };
    const orderless = id();
    await stops(
      /1 draft allocation\(s\) name no order.*SELECT id, created_at FROM allocations WHERE order_number IS NULL/,
      `INSERT INTO allocations (id,is_draft,created_by_user_id) VALUES ('${orderless}',true,'${user}')`,
      `DELETE FROM allocations WHERE id='${orderless}'`,
    );
    await stops(
      /1 draft allocation\(s\) hold half-entered blinds/,
      `UPDATE allocation_requirements SET width_mm=NULL WHERE id='${older.requirement}'`,
      `UPDATE allocation_requirements SET width_mm=600 WHERE id='${older.requirement}'`,
    );
    const second = id();
    await stops(
      /1 confirmed allocation\(s\) cut their blinds with differing drop allowances/,
      `INSERT INTO allocation_requirements (id,allocation_id,position,fabric_color_id,width_mm,length_mm,length_allowance_mm,quantity)
         VALUES ('${second}','${cancelled.id}',2,'${color}',600,1000,300,1)`,
      `DELETE FROM allocation_requirements WHERE id='${second}'`,
    );
    const stray = id();
    await stops(
      /1 work order line\(s\) already exist/,
      `INSERT INTO work_order_lines (id,work_order_id,position,fabric_color_id,width_mm,length_mm,quantity)
         SELECT '${stray}', id, 1, '${color}', 1, 1, 1 FROM work_orders LIMIT 1`,
      `DELETE FROM work_order_lines WHERE id='${stray}'`,
    );

    await migrate();

    // Each allocation names its order by id, and the number is the order's.
    const allocations = await client.query(
      `SELECT a.id, w.order_number, a.settings FROM allocations a JOIN work_orders w ON w.id=a.work_order_id`,
    );
    assert.deepEqual(
      new Map(allocations.rows.map((row) => [row.id, row.order_number])),
      new Map([
        [cancelled.id, '500001'],
        [live.id, '500001'],
        [shadowed.id, '500001'],
        [older.id, '500002'],
        [newer.id, '500002'],
      ]),
    );
    const columns = await client.query(
      `SELECT table_name, column_name FROM information_schema.columns
         WHERE (table_name='allocations' AND column_name='order_number')
            OR table_name='allocation_requirements'`,
    );
    assert.deepEqual(columns.rows, []);
    // One allowance per plan, taken from its blinds where it was not recorded.
    for (const row of allocations.rows.filter((row) => row.settings))
      assert.deepEqual(row.settings, { ...settings, dropAllowanceMm: 254 });

    // Every blind became a line under its old id, so every cut still points
    // at the blind it was planned for. An order's current blinds are those of
    // its live allocation, else of its newest draft; the rest are retired.
    const lines = await client.query(
      `SELECT l.id, w.order_number, l.width_mm, l.length_mm, l.quantity, l.retired_at
         FROM work_order_lines l JOIN work_orders w ON w.id=l.work_order_id`,
    );
    const line = (requirement: string) =>
      lines.rows.find((row) => row.id === requirement);
    assert.equal(lines.rowCount, 5);
    for (const [moved, orderNumber, active] of [
      [cancelled, '500001', false],
      [live, '500001', true],
      [shadowed, '500001', false],
      [older, '500002', false],
      [newer, '500002', true],
    ] as const) {
      const row = line(moved.requirement);
      assert.equal(row.order_number, orderNumber);
      assert.deepEqual(
        [row.width_mm, row.length_mm, row.quantity],
        ['600.000', '1000.000', 1],
      );
      assert.equal(row.retired_at === null, active, orderNumber);
      assert.equal(
        (
          await client.query(
            `SELECT work_order_line_id FROM allocation_cut_items WHERE allocation_cut_id=$1`,
            [moved.cut],
          )
        ).rows[0].work_order_line_id,
        moved.requirement,
      );
    }
    // A cancelled allocation's blinds were retired when it was.
    assert.deepEqual(
      line(cancelled.requirement).retired_at,
      new Date('2026-09-01'),
    );
    const counts = await client.query(
      `SELECT w.order_number, coalesce(sum(l.quantity) FILTER (WHERE l.retired_at IS NULL), 0)::int AS blinds
         FROM work_orders w LEFT JOIN work_order_lines l ON l.work_order_id=w.id GROUP BY 1 ORDER BY 1`,
    );
    assert.deepEqual(counts.rows, [
      { order_number: '500001', blinds: 1 },
      { order_number: '500002', blinds: 1 },
    ]);

    // The rewritten trigger still holds a confirmed plan's fields.
    await client.query('BEGIN');
    await client.query(
      `UPDATE allocation_cuts SET planned_length_mm=NULL WHERE id=$1`,
      [live.cut],
    );
    await assert.rejects(client.query('COMMIT'), {
      code: '23514',
      constraint: 'allocations_confirmed_fields_required',
    });
    // The later migrations accept what this one left, the rules check included.
    await migrateRest();
  },
);

test(
  '0029 holds confirmed allocations to the cutting rules they record, or stops',
  { timeout: 60_000 },
  async (t) => {
    const { client, migrate, migrateRest } = await databaseBefore(t, '0029_');
    const user = randomUUID();
    await client.query(
      `INSERT INTO users (id,name,email,microsoft_subject_id) VALUES ($1,'A','a@example.com','a')`,
      [user],
    );
    const rules = {
      edgeTrimMm: 1,
      minimumRemnantWidthMm: 100,
      minimumRemnantLengthMm: 100,
      dropAllowanceMm: 0,
    };
    /** An allocation of an order of its own; a draft when it has no time. */
    const allocation = async (
      settings: object | null,
      confirmedAt?: string,
    ) => {
      const [self, order] = [randomUUID(), randomUUID()];
      await client.query(
        `INSERT INTO work_orders (id, order_number) VALUES ($1, $2)`,
        [order, String(600000 + Math.floor(Math.random() * 99999))],
      );
      await client.query(
        `INSERT INTO allocations (id,is_draft,work_order_id,created_by_user_id,confirmed_at,settings)
           VALUES ($1,$2,$3,$4,$5,$6)`,
        [self, !confirmedAt, order, user, confirmedAt ?? null, settings],
      );
      return self;
    };
    // A draft's rules may be unfinished; zero is an allowance, not a gap.
    await allocation(null);
    const complete = await allocation(rules, '2026-09-01');
    const { dropAllowanceMm, ...withoutAllowance } = rules;
    const missing = await allocation(withoutAllowance, '2026-09-02');
    const text = await allocation(
      { ...rules, edgeTrimMm: String(rules.edgeTrimMm) },
      '2026-09-03',
    );

    await assert.rejects(
      migrate(),
      /2 confirmed allocation\(s\) do not record all four cutting rules as numbers.*SELECT id, settings FROM allocations WHERE NOT is_draft/,
    );
    await client.query(`UPDATE allocations SET settings=$1 WHERE id=ANY($2)`, [
      { ...rules, dropAllowanceMm },
      [missing, text],
    ]);
    await migrate();
    await migrateRest();

    for (const settings of [
      `settings - 'dropAllowanceMm'`,
      `settings - 'edgeTrimMm'`,
      `jsonb_set(settings, '{minimumRemnantWidthMm}', 'null')`,
      `NULL`,
    ])
      await assert.rejects(
        client.query(
          `UPDATE allocations SET settings=${settings} WHERE id=$1`,
          [complete],
        ),
        { code: '23514', constraint: 'allocations_confirmed_rules_recorded' },
      );
  },
);
