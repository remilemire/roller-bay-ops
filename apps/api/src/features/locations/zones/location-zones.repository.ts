import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, getTableColumns, ilike } from 'drizzle-orm';
import type {
  CreateLocationZone,
  UpdateLocationZone,
  LocationZoneQuery,
} from '@roller-bay/shared/locations';
import { DatabaseService } from '../../../database/database.service.js';
import { locationZones } from './location-zones.table.js';

import { locationsQuery, containsPattern } from '../locations.persistence.js';

@Injectable()
export class LocationZonesRepository {
  constructor(private readonly database: DatabaseService) {}
  list(query: LocationZoneQuery) {
    const where = and(
      query.search
        ? ilike(locationZones.name, containsPattern(query.search))
        : undefined,
    );
    return locationsQuery(() =>
      this.database.db.transaction(
        async (tx) => {
          const items = await tx
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
          const [result] = await tx
            .select({ total: count() })
            .from(locationZones)
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
        .select({ ...getTableColumns(locationZones) })
        .from(locationZones)
        .where(eq(locationZones.id, id));
      return row;
    });
  }
  create(input: CreateLocationZone) {
    return locationsQuery(() =>
      this.database.db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(locationZones)
          .values(input)
          .returning({ id: locationZones.id });
        if (!inserted) throw new Error('Insert returned no location record.');
        const [row] = await tx
          .select({ ...getTableColumns(locationZones) })
          .from(locationZones)
          .where(eq(locationZones.id, inserted.id));
        if (!row)
          throw new Error('Inserted location record could not be read.');
        return row;
      }),
    );
  }
  update(id: string, input: UpdateLocationZone) {
    return locationsQuery(() =>
      this.database.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(locationZones)
          .set(input)
          .where(eq(locationZones.id, id))
          .returning({ id: locationZones.id });
        if (!updated) return undefined;
        const [row] = await tx
          .select({ ...getTableColumns(locationZones) })
          .from(locationZones)
          .where(eq(locationZones.id, id));
        return row;
      }),
    );
  }
  delete(id: string) {
    return locationsQuery(async () => {
      const [row] = await this.database.db
        .delete(locationZones)
        .where(eq(locationZones.id, id))
        .returning({ id: locationZones.id });
      return row;
    }, true);
  }
}
