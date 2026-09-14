import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, getTableColumns, ilike } from 'drizzle-orm';
import type {
  CreateManufacturer,
  UpdateManufacturer,
  ManufacturerQuery,
} from '@roller-bay/shared/fabric-catalog';
import { DatabaseService } from '../../../database/database.service.js';
import { manufacturers } from './manufacturers.table.js';

import { catalogQuery, containsPattern } from '../catalog.persistence.js';

@Injectable()
export class ManufacturersRepository {
  constructor(private readonly database: DatabaseService) {}
  list(query: ManufacturerQuery) {
    const where = and(
      query.search
        ? ilike(manufacturers.name, containsPattern(query.search))
        : undefined,
    );
    return catalogQuery(() =>
      this.database.db.transaction(
        async (tx) => {
          const items = await tx
            .select({ ...getTableColumns(manufacturers) })
            .from(manufacturers)
            .where(where)
            .orderBy(asc(manufacturers.name), asc(manufacturers.id))
            .limit(query.pageSize)
            .offset((query.page - 1) * query.pageSize);
          const [result] = await tx
            .select({ total: count() })
            .from(manufacturers)
            .where(where);
          return { items, total: result!.total };
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      ),
    );
  }
  findById(id: string) {
    return catalogQuery(async () => {
      const [row] = await this.database.db
        .select({ ...getTableColumns(manufacturers) })
        .from(manufacturers)
        .where(eq(manufacturers.id, id));
      return row;
    });
  }
  create(input: CreateManufacturer) {
    return catalogQuery(() =>
      this.database.db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(manufacturers)
          .values(input)
          .returning({ id: manufacturers.id });
        if (!inserted) throw new Error('Insert returned no catalog record.');
        const [row] = await tx
          .select({ ...getTableColumns(manufacturers) })
          .from(manufacturers)
          .where(eq(manufacturers.id, inserted.id));
        if (!row) throw new Error('Inserted catalog record could not be read.');
        return row;
      }),
    );
  }
  update(id: string, input: UpdateManufacturer) {
    return catalogQuery(() =>
      this.database.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(manufacturers)
          .set(input)
          .where(eq(manufacturers.id, id))
          .returning({ id: manufacturers.id });
        if (!updated) return undefined;
        const [row] = await tx
          .select({ ...getTableColumns(manufacturers) })
          .from(manufacturers)
          .where(eq(manufacturers.id, id));
        return row;
      }),
    );
  }
  delete(id: string) {
    return catalogQuery(async () => {
      const [row] = await this.database.db
        .delete(manufacturers)
        .where(eq(manufacturers.id, id))
        .returning({ id: manufacturers.id });
      return row;
    }, true);
  }
}
