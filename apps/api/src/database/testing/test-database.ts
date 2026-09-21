import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

// The same depth from src/, .test-dist/ and dist/.
export const migrationsFolder = fileURLToPath(
  new URL('../../../drizzle', import.meta.url),
);

/**
 * A new database on the server `adminUrl` points at, built by applying every
 * migration, so tests see exactly the names and objects production has. The
 * migrations qualify their objects with `public`, which rules out a schema
 * inside a shared database.
 *
 * `migrated: false` leaves it empty, for the test that applies the migrations
 * itself to check how they move existing rows.
 *
 * Only a database this call named is ever dropped, so `adminUrl` may be the
 * development server: its own database is used for one CREATE and one DROP.
 * A run killed by a signal leaks its database; docs/testing.md has the cleanup.
 */
export async function createTestDatabase(
  adminUrl: string,
  { migrated = true } = {},
) {
  const name = `rb_test_${randomBytes(16).toString('hex')}`;
  const admin = async (statement: string) => {
    const pool = new Pool({ connectionString: adminUrl, max: 1 });
    try {
      await pool.query(statement);
    } finally {
      await pool.end();
    }
  };
  // The name is generated above, never supplied, so it is safe to interpolate.
  const drop = () => admin(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin(`CREATE DATABASE "${name}"`);
  const target = new URL(adminUrl);
  target.pathname = `/${name}`;
  if (!migrated) return { url: target.href, drop };
  const pool = new Pool({ connectionString: target.href, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder });
  } catch (error) {
    await pool.end();
    await drop();
    throw error;
  }
  await pool.end();
  return { url: target.href, drop };
}
