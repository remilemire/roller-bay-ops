import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, getTableColumns, ilike, or } from 'drizzle-orm';
import type {
  CreateFabricColor,
  UpdateFabricColor,
  FabricColorQuery,
} from '@roller-bay/shared/fabric-catalog';
import { DatabaseService } from '../../../database/database.service.js';
import { fabricColors } from './fabric-colors.table.js';
import { fabricMaterials } from '../materials/fabric-materials.table.js';
import { manufacturers } from '../manufacturers/manufacturers.table.js';
import { catalogQuery, containsPattern } from '../catalog.persistence.js';

@Injectable()
export class FabricColorsRepository {
  constructor(private readonly database: DatabaseService) {}
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
    return catalogQuery(() =>
      this.database.db.transaction(
        async (tx) => {
          const items = await tx
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
          const [result] = await tx
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
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      ),
    );
  }
  findById(id: string) {
    return catalogQuery(async () => {
      const [row] = await this.database.db
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
    return catalogQuery(() =>
      this.database.db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(fabricColors)
          .values({ ...input, thicknessMm: input.thicknessMm.toFixed(3) })
          .returning({ id: fabricColors.id });
        if (!inserted) throw new Error('Insert returned no catalog record.');
        const [row] = await tx
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
      }),
    );
  }
  update(id: string, input: UpdateFabricColor) {
    return catalogQuery(() =>
      this.database.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(fabricColors)
          .set({ ...input, thicknessMm: input.thicknessMm?.toFixed(3) })
          .where(eq(fabricColors.id, id))
          .returning({ id: fabricColors.id });
        if (!updated) return undefined;
        const [row] = await tx
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
      }),
    );
  }
  delete(id: string) {
    return catalogQuery(async () => {
      const [row] = await this.database.db
        .delete(fabricColors)
        .where(eq(fabricColors.id, id))
        .returning({ id: fabricColors.id });
      return row;
    }, true);
  }
}
