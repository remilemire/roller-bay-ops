import type {
  CreateLocationZone,
  LocationZoneQuery,
  UpdateLocationZone,
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
import { locationSections } from '../sections/location-sections.table.js';
import { locationZones } from './location-zones.table.js';
export class LocationZonesRepository {
  constructor(private readonly db: DatabaseExecutor) {}
  list(query: LocationZoneQuery) {
    const pattern = containsPattern(query.search ?? '');
    const where = and(
      // The locations tree searches every level at once, so a zone also
      // matches through any of its sections or their levels.
      query.search
        ? or(
            ilike(locationZones.name, pattern),
            exists(
              this.db
                .select({ id: locationSections.id })
                .from(locationSections)
                .leftJoin(
                  locations,
                  eq(locations.sectionId, locationSections.id),
                )
                .where(
                  and(
                    eq(locationSections.zoneId, locationZones.id),
                    or(
                      ilike(locationSections.label, pattern),
                      ilike(locations.label, pattern),
                    ),
                  ),
                ),
            ),
          )
        : undefined,
    );
    return locationsQuery(async () => {
      const items = await this.db
        .select({ ...getTableColumns(locationZones) })
        .from(locationZones)
        .where(where)
        .orderBy(
          asc(locationZones.sortOrder),
          asc(locationZones.name),
          asc(locationZones.id),
        )
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);
      const [result] = await this.db
        .select({ total: count() })
        .from(locationZones)
        .where(where);
      return { items, total: result!.total };
    });
  }
  findById(id: string) {
    return locationsQuery(async () => {
      const [row] = await this.db
        .select({ ...getTableColumns(locationZones) })
        .from(locationZones)
        .where(eq(locationZones.id, id));
      return row;
    });
  }
  create(input: CreateLocationZone) {
    return locationsQuery(async () => {
      const [inserted] = await this.db
        .insert(locationZones)
        .values(input)
        .returning({ id: locationZones.id });
      if (!inserted) throw new Error('Insert returned no location record.');
      const [row] = await this.db
        .select({ ...getTableColumns(locationZones) })
        .from(locationZones)
        .where(eq(locationZones.id, inserted.id));
      if (!row) throw new Error('Inserted location record could not be read.');
      return row;
    });
  }
  update(id: string, input: UpdateLocationZone) {
    return locationsQuery(async () => {
      const [updated] = await this.db
        .update(locationZones)
        .set(input)
        .where(eq(locationZones.id, id))
        .returning({ id: locationZones.id });
      if (!updated) return undefined;
      const [row] = await this.db
        .select({ ...getTableColumns(locationZones) })
        .from(locationZones)
        .where(eq(locationZones.id, id));
      return row;
    });
  }
  delete(id: string) {
    return locationsQuery(async () => {
      const [row] = await this.db
        .delete(locationZones)
        .where(eq(locationZones.id, id))
        .returning({ id: locationZones.id });
      return row;
    }, true);
  }
}
