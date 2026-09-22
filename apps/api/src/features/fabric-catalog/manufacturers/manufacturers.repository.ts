import type {
  CreateManufacturer,
  ManufacturerQuery,
  UpdateManufacturer,
} from '@roller-bay/shared/fabric-catalog';
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
import { catalogQuery, containsPattern } from '../catalog.persistence.js';
import { fabricColors } from '../colors/fabric-colors.table.js';
import { fabricMaterials } from '../materials/fabric-materials.table.js';
import { manufacturers } from './manufacturers.table.js';
export class ManufacturersRepository {
  constructor(private readonly db: DatabaseExecutor) {}
  list(query: ManufacturerQuery) {
    const pattern = containsPattern(query.search ?? '');
    const where = and(
      // The catalog tree searches every level at once, so a manufacturer
      // also matches through any of its materials or their colors.
      query.search
        ? or(
            ilike(manufacturers.name, pattern),
            exists(
              this.db
                .select({ id: fabricMaterials.id })
                .from(fabricMaterials)
                .leftJoin(
                  fabricColors,
                  eq(fabricColors.materialId, fabricMaterials.id),
                )
                .where(
                  and(
                    eq(fabricMaterials.manufacturerId, manufacturers.id),
                    or(
                      ilike(fabricMaterials.name, pattern),
                      ilike(fabricColors.code, pattern),
                    ),
                  ),
                ),
            ),
          )
        : undefined,
    );
    return catalogQuery(async () => {
      const items = await this.db
        .select({ ...getTableColumns(manufacturers) })
        .from(manufacturers)
        .where(where)
        .orderBy(asc(manufacturers.name), asc(manufacturers.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);
      const [result] = await this.db
        .select({ total: count() })
        .from(manufacturers)
        .where(where);
      return { items, total: result!.total };
    });
  }
  findById(id: string) {
    return catalogQuery(async () => {
      const [row] = await this.db
        .select({ ...getTableColumns(manufacturers) })
        .from(manufacturers)
        .where(eq(manufacturers.id, id));
      return row;
    });
  }
  create(input: CreateManufacturer) {
    return catalogQuery(async () => {
      const [inserted] = await this.db
        .insert(manufacturers)
        .values(input)
        .returning({ id: manufacturers.id });
      if (!inserted) throw new Error('Insert returned no catalog record.');
      const [row] = await this.db
        .select({ ...getTableColumns(manufacturers) })
        .from(manufacturers)
        .where(eq(manufacturers.id, inserted.id));
      if (!row) throw new Error('Inserted catalog record could not be read.');
      return row;
    });
  }
  update(id: string, input: UpdateManufacturer) {
    return catalogQuery(async () => {
      const [updated] = await this.db
        .update(manufacturers)
        .set(input)
        .where(eq(manufacturers.id, id))
        .returning({ id: manufacturers.id });
      if (!updated) return undefined;
      const [row] = await this.db
        .select({ ...getTableColumns(manufacturers) })
        .from(manufacturers)
        .where(eq(manufacturers.id, id));
      return row;
    });
  }
  delete(id: string) {
    return catalogQuery(async () => {
      const [row] = await this.db
        .delete(manufacturers)
        .where(eq(manufacturers.id, id))
        .returning({ id: manufacturers.id });
      return row;
    }, true);
  }
}
