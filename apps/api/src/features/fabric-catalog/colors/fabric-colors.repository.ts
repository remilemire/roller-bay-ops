import type {
  CreateFabricColor,
  FabricColorQuery,
  UpdateFabricColor,
} from '@roller-bay/shared/fabric-catalog';
import { and, asc, count, eq, getTableColumns, ilike, or } from 'drizzle-orm';
import type { DatabaseExecutor } from '../../../database/database-executor.js';
import { catalogQuery, containsPattern } from '../catalog.persistence.js';
import { manufacturers } from '../manufacturers/manufacturers.table.js';
import { fabricMaterials } from '../materials/fabric-materials.table.js';
import { fabricColors } from './fabric-colors.table.js';
export class FabricColorsRepository {
  constructor(private readonly db: DatabaseExecutor) {}
  list(query: FabricColorQuery) {
    const where = and(
      // Match every part of the label a lookup shows for a color.
      query.search
        ? or(
            ilike(fabricColors.code, containsPattern(query.search)),
            ilike(fabricMaterials.name, containsPattern(query.search)),
            ilike(manufacturers.name, containsPattern(query.search)),
          )
        : undefined,
      query.materialId
        ? eq(fabricColors.materialId, query.materialId)
        : undefined,
      query.manufacturerId
        ? eq(fabricMaterials.manufacturerId, query.manufacturerId)
        : undefined,
    );
    return catalogQuery(async () => {
      const items = await this.db
        .select({
          ...getTableColumns(fabricColors),
          materialName: fabricMaterials.name,
          manufacturerId: manufacturers.id,
          manufacturerName: manufacturers.name,
        })
        .from(fabricColors)
        .innerJoin(
          fabricMaterials,
          eq(fabricColors.materialId, fabricMaterials.id),
        )
        .innerJoin(
          manufacturers,
          eq(fabricMaterials.manufacturerId, manufacturers.id),
        )
        .where(where)
        .orderBy(asc(fabricColors.code), asc(fabricColors.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);
      const [result] = await this.db
        .select({ total: count() })
        .from(fabricColors)
        .innerJoin(
          fabricMaterials,
          eq(fabricColors.materialId, fabricMaterials.id),
        )
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
          ...getTableColumns(fabricColors),
          materialName: fabricMaterials.name,
          manufacturerId: manufacturers.id,
          manufacturerName: manufacturers.name,
        })
        .from(fabricColors)
        .innerJoin(
          fabricMaterials,
          eq(fabricColors.materialId, fabricMaterials.id),
        )
        .innerJoin(
          manufacturers,
          eq(fabricMaterials.manufacturerId, manufacturers.id),
        )
        .where(eq(fabricColors.id, id));
      return row;
    });
  }
  create(input: CreateFabricColor) {
    return catalogQuery(async () => {
      const [inserted] = await this.db
        .insert(fabricColors)
        .values({ ...input, thicknessMm: input.thicknessMm.toFixed(3) })
        .returning({ id: fabricColors.id });
      if (!inserted) throw new Error('Insert returned no catalog record.');
      const [row] = await this.db
        .select({
          ...getTableColumns(fabricColors),
          materialName: fabricMaterials.name,
          manufacturerId: manufacturers.id,
          manufacturerName: manufacturers.name,
        })
        .from(fabricColors)
        .innerJoin(
          fabricMaterials,
          eq(fabricColors.materialId, fabricMaterials.id),
        )
        .innerJoin(
          manufacturers,
          eq(fabricMaterials.manufacturerId, manufacturers.id),
        )
        .where(eq(fabricColors.id, inserted.id));
      if (!row) throw new Error('Inserted catalog record could not be read.');
      return row;
    });
  }
  update(id: string, input: UpdateFabricColor) {
    return catalogQuery(async () => {
      const [updated] = await this.db
        .update(fabricColors)
        .set({ ...input, thicknessMm: input.thicknessMm?.toFixed(3) })
        .where(eq(fabricColors.id, id))
        .returning({ id: fabricColors.id });
      if (!updated) return undefined;
      const [row] = await this.db
        .select({
          ...getTableColumns(fabricColors),
          materialName: fabricMaterials.name,
          manufacturerId: manufacturers.id,
          manufacturerName: manufacturers.name,
        })
        .from(fabricColors)
        .innerJoin(
          fabricMaterials,
          eq(fabricColors.materialId, fabricMaterials.id),
        )
        .innerJoin(
          manufacturers,
          eq(fabricMaterials.manufacturerId, manufacturers.id),
        )
        .where(eq(fabricColors.id, id));
      return row;
    });
  }
  delete(id: string) {
    return catalogQuery(async () => {
      const [row] = await this.db
        .delete(fabricColors)
        .where(eq(fabricColors.id, id))
        .returning({ id: fabricColors.id });
      return row;
    }, true);
  }
}
