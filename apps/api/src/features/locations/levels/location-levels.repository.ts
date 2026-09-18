import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, getTableColumns, ilike, or } from 'drizzle-orm';
import type {
  CreateLocation,
  UpdateLocation,
  LocationQuery,
} from '@roller-bay/shared/locations';
import { DatabaseService } from '../../../database/database.service.js';
import { locations } from './location-levels.table.js';
import { locationSections } from '../sections/location-sections.table.js';
import { locationZones } from '../zones/location-zones.table.js';
import { locationsQuery, containsPattern } from '../locations.persistence.js';

@Injectable()
export class LocationLevelsRepository {
  constructor(private readonly database: DatabaseService) {}
  list(query: LocationQuery) {
    const where = and(
      // A level is shown as zone / section / label; match any of the three.
      query.search
        ? or(
            ilike(locations.label, containsPattern(query.search)),
            ilike(locationSections.label, containsPattern(query.search)),
            ilike(locationZones.name, containsPattern(query.search)),
          )
        : undefined,
      query.sectionId ? eq(locations.sectionId, query.sectionId) : undefined,
      query.zoneId ? eq(locationSections.zoneId, query.zoneId) : undefined,
    );
    return locationsQuery(() =>
      this.database.db.transaction(
        async (tx) => {
          const items = await tx
            .select({
              ...getTableColumns(locations),
              sectionLabel: locationSections.label,
              zoneId: locationZones.id,
              zoneName: locationZones.name,
            })
            .from(locations)
            .innerJoin(
              locationSections,
              eq(locations.sectionId, locationSections.id),
            )
            .innerJoin(
              locationZones,
              eq(locationSections.zoneId, locationZones.id),
            )
            .where(where)
            .orderBy(
              asc(locations.sortOrder),
              asc(locations.label),
              asc(locations.id),
            )
            .limit(query.pageSize)
            .offset((query.page - 1) * query.pageSize);
          const [result] = await tx
            .select({ total: count() })
            .from(locations)
            .innerJoin(
              locationSections,
              eq(locations.sectionId, locationSections.id),
            )
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
          ...getTableColumns(locations),
          sectionLabel: locationSections.label,
          zoneId: locationZones.id,
          zoneName: locationZones.name,
        })
        .from(locations)
        .innerJoin(
          locationSections,
          eq(locations.sectionId, locationSections.id),
        )
        .innerJoin(locationZones, eq(locationSections.zoneId, locationZones.id))
        .where(eq(locations.id, id));
      return row;
    });
  }
  create(input: CreateLocation) {
    return locationsQuery(() =>
      this.database.db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(locations)
          .values(input)
          .returning({ id: locations.id });
        if (!inserted) throw new Error('Insert returned no location record.');
        const [row] = await tx
          .select({
            ...getTableColumns(locations),
            sectionLabel: locationSections.label,
            zoneId: locationZones.id,
            zoneName: locationZones.name,
          })
          .from(locations)
          .innerJoin(
            locationSections,
            eq(locations.sectionId, locationSections.id),
          )
          .innerJoin(
            locationZones,
            eq(locationSections.zoneId, locationZones.id),
          )
          .where(eq(locations.id, inserted.id));
        if (!row)
          throw new Error('Inserted location record could not be read.');
        return row;
      }),
    );
  }
  update(id: string, input: UpdateLocation) {
    return locationsQuery(() =>
      this.database.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(locations)
          .set(input)
          .where(eq(locations.id, id))
          .returning({ id: locations.id });
        if (!updated) return undefined;
        const [row] = await tx
          .select({
            ...getTableColumns(locations),
            sectionLabel: locationSections.label,
            zoneId: locationZones.id,
            zoneName: locationZones.name,
          })
          .from(locations)
          .innerJoin(
            locationSections,
            eq(locations.sectionId, locationSections.id),
          )
          .innerJoin(
            locationZones,
            eq(locationSections.zoneId, locationZones.id),
          )
          .where(eq(locations.id, id));
        return row;
      }),
    );
  }
  delete(id: string) {
    return locationsQuery(async () => {
      const [row] = await this.database.db
        .delete(locations)
        .where(eq(locations.id, id))
        .returning({ id: locations.id });
      return row;
    }, true);
  }
}
