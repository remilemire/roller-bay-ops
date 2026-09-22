import type {
  CreateFabricMaterial,
  FabricMaterialQuery,
  UpdateFabricMaterial,
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
import { manufacturers } from '../manufacturers/manufacturers.table.js';
import { fabricMaterials } from './fabric-materials.table.js';
export class FabricMaterialsRepository {
  constructor(private readonly db: DatabaseExecutor) {}
  list(query: FabricMaterialQuery) {
    const pattern = containsPattern(query.search ?? '');
    const where = and(
      // Match the material, its manufacturer, or any of its colors, so the
      // catalog tree can search every level at once.
      query.search
        ? or(
            ilike(fabricMaterials.name, pattern),
            ilike(manufacturers.name, pattern),
            exists(
              this.db
                .select({ id: fabricColors.id })
                .from(fabricColors)
                .where(
                  and(
                    eq(fabricColors.materialId, fabricMaterials.id),
                    ilike(fabricColors.code, pattern),
                  ),
                ),
            ),
          )
        : undefined,
      query.manufacturerId
        ? eq(fabricMaterials.manufacturerId, query.manufacturerId)
        : undefined,
    );
    return catalogQuery(async () => {
      const items = await this.db
        .select({
          ...getTableColumns(fabricMaterials),
          manufacturerName: manufacturers.name,
        })
        .from(fabricMaterials)
        .innerJoin(
          manufacturers,
          eq(fabricMaterials.manufacturerId, manufacturers.id),
        )
        .where(where)
        .orderBy(asc(fabricMaterials.name), asc(fabricMaterials.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);
      const [result] = await this.db
        .select({ total: count() })
        .from(fabricMaterials)
        .innerJoin(
          manufacturers,
          eq(fabricMaterials.manufacturerId, manufacturers.id),
        )
        .where(where);
      return { items, total: result!.total };
    });
  }
  findById(id: string) {
    return catalogQuery(async () => {
      const [row] = await this.db
        .select({
          ...getTableColumns(fabricMaterials),
          manufacturerName: manufacturers.name,
        })
        .from(fabricMaterials)
        .innerJoin(
          manufacturers,
          eq(fabricMaterials.manufacturerId, manufacturers.id),
        )
        .where(eq(fabricMaterials.id, id));
      return row;
    });
  }
  create(input: CreateFabricMaterial) {
    return catalogQuery(async () => {
      const [inserted] = await this.db
        .insert(fabricMaterials)
        .values(input)
        .returning({ id: fabricMaterials.id });
      if (!inserted) throw new Error('Insert returned no catalog record.');
      const [row] = await this.db
        .select({
          ...getTableColumns(fabricMaterials),
          manufacturerName: manufacturers.name,
        })
        .from(fabricMaterials)
        .innerJoin(
          manufacturers,
          eq(fabricMaterials.manufacturerId, manufacturers.id),
        )
        .where(eq(fabricMaterials.id, inserted.id));
      if (!row) throw new Error('Inserted catalog record could not be read.');
      return row;
    });
  }
  update(id: string, input: UpdateFabricMaterial) {
    return catalogQuery(async () => {
      const [updated] = await this.db
        .update(fabricMaterials)
        .set(input)
        .where(eq(fabricMaterials.id, id))
        .returning({ id: fabricMaterials.id });
      if (!updated) return undefined;
      const [row] = await this.db
        .select({
          ...getTableColumns(fabricMaterials),
          manufacturerName: manufacturers.name,
        })
        .from(fabricMaterials)
        .innerJoin(
          manufacturers,
          eq(fabricMaterials.manufacturerId, manufacturers.id),
        )
        .where(eq(fabricMaterials.id, id));
      return row;
    });
  }
  delete(id: string) {
    return catalogQuery(async () => {
      const [row] = await this.db
        .delete(fabricMaterials)
        .where(eq(fabricMaterials.id, id))
        .returning({ id: fabricMaterials.id });
      return row;
    }, true);
  }
}
