import { sql } from 'drizzle-orm';
import type { DatabaseExecutor } from '../../database/database-executor.js';
import { locations } from './levels/location-levels.table.js';
import { locationSections } from './sections/location-sections.table.js';
import { locationZones } from './zones/location-zones.table.js';
const resources = {
  zones: { table: locationZones, label: locationZones.name, parent: null },
  sections: {
    table: locationSections,
    label: locationSections.label,
    parent: locationSections.zoneId,
  },
  levels: {
    table: locations,
    label: locations.label,
    parent: locations.sectionId,
  },
};
export type OrderedLocationKind = keyof typeof resources;
export class LocationOrderRepository {
  constructor(private readonly db: DatabaseExecutor) {}
  async lockSiblings(kind: OrderedLocationKind, id: string) {
    const { table, label, parent } = resources[kind];
    // Reference lists are small. A table write lock also serializes legacy
    // sortOrder edits, inserts, and deletes without changing their endpoints.
    // Ordinary reads remain available until this short transaction commits.
    await this.db.execute(sql`LOCK TABLE ${table} IN SHARE ROW EXCLUSIVE MODE`);
    const scope = parent
      ? sql`${parent} = (SELECT ${parent} FROM ${table} WHERE ${table.id} = ${id})`
      : sql`true`;
    const result = await this.db.execute<{
      id: string;
      sortOrder: number;
    }>(sql`
      SELECT ${table.id} AS id, ${table.sortOrder} AS "sortOrder"
      FROM ${table} WHERE ${scope}
      ORDER BY ${table.sortOrder}, ${label}, ${table.id}
    `);
    return result.rows;
  }
  async saveOrder(kind: OrderedLocationKind, ids: string[]) {
    const { table } = resources[kind];
    // One statement updates all siblings, including those outside the UI page.
    const entries = ids.map(
      (id, index) => sql`(${id}::uuid, ${index}::integer)`,
    );
    await this.db.execute(sql`
      UPDATE ${table} SET sort_order = ordering.rank, updated_at = now()
      FROM (VALUES ${sql.join(entries, sql`, `)}) AS ordering(id, rank)
      WHERE ${table.id} = ordering.id AND ${table.sortOrder} <> ordering.rank
    `);
  }
}
