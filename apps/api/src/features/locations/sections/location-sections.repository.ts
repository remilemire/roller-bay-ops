import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, getTableColumns, ilike } from 'drizzle-orm';
import type {
  CreateLocationSection,
  UpdateLocationSection,
  LocationSectionQuery,
} from '@roller-bay/shared/locations';
import { DatabaseService } from '../../../database/database.service.js';
import { locationSections } from './location-sections.table.js';
import { locationZones } from '../zones/location-zones.table.js';
import { locationsQuery, containsPattern } from '../locations.persistence.js';

@Injectable()
export class LocationSectionsRepository {
  constructor(private readonly database: DatabaseService) {}
  list(query: LocationSectionQuery) {
    const where = and(
      query.search
        ? ilike(locationSections.label, containsPattern(query.search))
        : undefined,
      query.zoneId ? eq(locationSections.zoneId, query.zoneId) : undefined,
    );
    return locationsQuery(() =>
      this.database.db.transaction(
        async (tx) => {
          const items = await tx
            .select({
              ...getTableColumns(locationSections),
              zoneName: locationZones.name,
            })
            .from(locationSections)
            .innerJoin(
              locationZones,
              eq(locationSections.zoneId, locationZones.id),
            )
            .where(where)
            .orderBy(
              asc(locationSections.sortOrder),
              asc(locationSections.label),
              asc(locationSections.id),
            )
            .limit(query.pageSize)
            .offset((query.page - 1) * query.pageSize);
          const [result] = await tx
            .select({ total: count() })
            .from(locationSections)
            .innerJoin(
              locationZones,
              eq(locationSections.zoneId, locationZones.id),
            )
            .where(where);
          return { items, total: result!.total };
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      ),
    );
  }
  findById(id: string) {
    return locationsQuery(async () => {
      const [row] = await this.database.db
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
    return locationsQuery(() =>
      this.database.db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(locationSections)
          .values(input)
          .returning({ id: locationSections.id });
        if (!inserted) throw new Error('Insert returned no location record.');
        const [row] = await tx
          .select({
            ...getTableColumns(locationSections),
            zoneName: locationZones.name,
          })
          .from(locationSections)
          .innerJoin(
            locationZones,
            eq(locationSections.zoneId, locationZones.id),
          )
          .where(eq(locationSections.id, inserted.id));
        if (!row)
          throw new Error('Inserted location record could not be read.');
        return row;
      }),
    );
  }
  update(id: string, input: UpdateLocationSection) {
    return locationsQuery(() =>
      this.database.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(locationSections)
          .set(input)
          .where(eq(locationSections.id, id))
          .returning({ id: locationSections.id });
        if (!updated) return undefined;
        const [row] = await tx
          .select({
            ...getTableColumns(locationSections),
            zoneName: locationZones.name,
          })
          .from(locationSections)
          .innerJoin(
            locationZones,
            eq(locationSections.zoneId, locationZones.id),
          )
          .where(eq(locationSections.id, id));
        return row;
      }),
    );
  }
  delete(id: string) {
    return locationsQuery(async () => {
      const [row] = await this.database.db
        .delete(locationSections)
        .where(eq(locationSections.id, id))
        .returning({ id: locationSections.id });
      return row;
    }, true);
  }
}
