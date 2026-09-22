import type {
  CreateLocationSection,
  LocationSectionQuery,
  UpdateLocationSection,
} from '@roller-bay/shared/locations';
import {
  and,
  asc,
  count,
  eq,
  exists,
  getTableColumns,
  ilike,
  or,
} from 'drizzle-orm';
import type { DatabaseExecutor } from '../../../database/database-executor.js';
import { locations } from '../levels/location-levels.table.js';
import { containsPattern, locationsQuery } from '../locations.persistence.js';
import { locationZones } from '../zones/location-zones.table.js';
import { locationSections } from './location-sections.table.js';
export class LocationSectionsRepository {
  constructor(private readonly db: DatabaseExecutor) {}
  list(query: LocationSectionQuery) {
    const pattern = containsPattern(query.search ?? '');
    const where = and(
      // Match the section, its zone, or any of its levels, so the locations
      // tree can search every level at once.
      query.search
        ? or(
            ilike(locationSections.label, pattern),
            ilike(locationZones.name, pattern),
            exists(
              this.db
                .select({ id: locations.id })
                .from(locations)
                .where(
                  and(
                    eq(locations.sectionId, locationSections.id),
                    ilike(locations.label, pattern),
                  ),
                ),
            ),
          )
        : undefined,
      query.zoneId ? eq(locationSections.zoneId, query.zoneId) : undefined,
    );
    return locationsQuery(async () => {
      const items = await this.db
        .select({
          ...getTableColumns(locationSections),
          zoneName: locationZones.name,
        })
        .from(locationSections)
        .innerJoin(locationZones, eq(locationSections.zoneId, locationZones.id))
        .where(where)
        .orderBy(
          asc(locationSections.sortOrder),
          asc(locationSections.label),
          asc(locationSections.id),
        )
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);
      const [result] = await this.db
        .select({ total: count() })
        .from(locationSections)
        .innerJoin(locationZones, eq(locationSections.zoneId, locationZones.id))
        .where(where);
      return { items, total: result!.total };
    });
  }
  findById(id: string) {
    return locationsQuery(async () => {
      const [row] = await this.db
        .select({
          ...getTableColumns(locationSections),
          zoneName: locationZones.name,
        })
        .from(locationSections)
        .innerJoin(locationZones, eq(locationSections.zoneId, locationZones.id))
        .where(eq(locationSections.id, id));
      return row;
    });
  }
  create(input: CreateLocationSection) {
    return locationsQuery(async () => {
      const [inserted] = await this.db
        .insert(locationSections)
        .values(input)
        .returning({ id: locationSections.id });
      if (!inserted) throw new Error('Insert returned no location record.');
      const [row] = await this.db
        .select({
          ...getTableColumns(locationSections),
          zoneName: locationZones.name,
        })
        .from(locationSections)
        .innerJoin(locationZones, eq(locationSections.zoneId, locationZones.id))
        .where(eq(locationSections.id, inserted.id));
      if (!row) throw new Error('Inserted location record could not be read.');
      return row;
    });
  }
  update(id: string, input: UpdateLocationSection) {
    return locationsQuery(async () => {
      const [updated] = await this.db
        .update(locationSections)
        .set(input)
        .where(eq(locationSections.id, id))
        .returning({ id: locationSections.id });
      if (!updated) return undefined;
      const [row] = await this.db
        .select({
          ...getTableColumns(locationSections),
          zoneName: locationZones.name,
        })
        .from(locationSections)
        .innerJoin(locationZones, eq(locationSections.zoneId, locationZones.id))
        .where(eq(locationSections.id, id));
      return row;
    });
  }
  delete(id: string) {
    return locationsQuery(async () => {
      const [row] = await this.db
        .delete(locationSections)
        .where(eq(locationSections.id, id))
        .returning({ id: locationSections.id });
      return row;
    }, true);
  }
}
