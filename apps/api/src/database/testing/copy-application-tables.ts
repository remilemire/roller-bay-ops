import type { Pool } from 'pg';

const tables = [
  'users',
  'manufacturers',
  'fabric_materials',
  'fabric_colors',
  'location_zones',
  'location_sections',
  'locations',
  'stock_receipts',
  'stock_receipt_items',
  'fabric_stock_items',
  'allocations',
  'allocation_requirements',
  'allocation_items',
  'allocation_cuts',
  'allocation_cut_items',
];
const identifier = (name: string) => `"${name.replaceAll('"', '""')}"`;

// Test rows remain isolated, but their structure comes from the migrated DB.
export async function copyApplicationTables(pool: Pool, schema: string) {
  const client = await pool.connect();
  const target = identifier(schema);
  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA ${target}`);
    // Force introspected references to include their source schema.
    await client.query('SET LOCAL search_path TO pg_catalog');
    for (const table of tables) {
      await client.query(
        `CREATE TABLE ${target}.${identifier(table)} (LIKE public.${identifier(table)} INCLUDING ALL)`,
      );
    }
    // LIKE generates new index/constraint names. Preserve the names that
    // repositories use to distinguish domain conflicts from storage errors.
    await client.query(
      `ALTER INDEX ${target}.users_lower_idx RENAME TO users_email_unique`,
    );
    await client.query(
      `ALTER TABLE ${target}.fabric_colors RENAME CONSTRAINT fabric_colors_code_key TO fabric_colors_code_unique`,
    );
    await client.query(
      `ALTER INDEX ${target}.location_zones_lower_idx RENAME TO location_zones_name_unique`,
    );
    await client.query(
      `ALTER INDEX ${target}.location_sections_zone_id_lower_idx RENAME TO location_sections_zone_label_unique`,
    );
    await client.query(
      `ALTER INDEX ${target}.locations_section_id_lower_idx RENAME TO locations_section_label_unique`,
    );

    // LIKE does not copy foreign keys. Recreate the live definitions and bind
    // them to test tables so deletes cannot touch application data.
    const { rows } = await client.query<{
      table_name: string;
      constraint_name: string;
      definition: string;
      referenced_table: string;
      referenced_schema: string;
    }>(
      `SELECT t.relname AS table_name, c.conname AS constraint_name,
              pg_get_constraintdef(c.oid) AS definition,
              r.relname AS referenced_table, rn.nspname AS referenced_schema
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       JOIN pg_class r ON r.oid = c.confrelid
       JOIN pg_namespace rn ON rn.oid = r.relnamespace
       WHERE n.nspname = 'public' AND t.relname = ANY($1) AND c.contype = 'f'`,
      [tables],
    );
    for (const constraint of rows) {
      if (
        constraint.referenced_schema !== 'public' ||
        !tables.includes(constraint.referenced_table)
      )
        throw new Error(
          'The test fixture must include every referenced table.',
        );
      if (!constraint.definition.includes('REFERENCES public.'))
        throw new Error('Expected a schema-qualified foreign key.');
      const definition = constraint.definition.replace(
        'REFERENCES public.',
        `REFERENCES ${target}.`,
      );
      await client.query(
        `ALTER TABLE ${target}.${identifier(constraint.table_name)} ADD CONSTRAINT ${identifier(constraint.constraint_name)} ${definition}`,
      );
    }
    // LIKE also omits user triggers. These functions resolve their data through
    // TG_TABLE_SCHEMA, so reuse the migrated functions on the isolated tables.
    const triggers = await client.query<{ definition: string }>(
      `SELECT pg_get_triggerdef(trigger.oid) AS definition
       FROM pg_trigger trigger
       JOIN pg_class t ON t.oid = trigger.tgrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname = 'public' AND t.relname = ANY($1)
         AND NOT trigger.tgisinternal`,
      [tables],
    );
    for (const { definition } of triggers.rows) {
      if (!definition.includes(' ON public.'))
        throw new Error('Expected a schema-qualified trigger table.');
      await client.query(definition.replace(' ON public.', ` ON ${target}.`));
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
