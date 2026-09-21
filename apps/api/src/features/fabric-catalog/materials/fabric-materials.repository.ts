import { Injectable } from '@nestjs/common';
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
import type {
  CreateFabricMaterial,
  UpdateFabricMaterial,
  FabricMaterialQuery,
} from '@roller-bay/shared/fabric-catalog';
import { DatabaseService } from '../../../database/database.service.js';
import { fabricMaterials } from './fabric-materials.table.js';
import { manufacturers } from '../manufacturers/manufacturers.table.js';
import { fabricColors } from '../colors/fabric-colors.table.js';
import { catalogQuery, containsPattern } from '../catalog.persistence.js';

@Injectable()
export class FabricMaterialsRepository {
  constructor(private readonly database: DatabaseService) {}
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
              this.database.db
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
    return catalogQuery(() =>
      this.database.db.transaction(
        async (tx) => {
          const items = await tx
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
          const [result] = await tx
            .select({ total: count() })
            .from(fabricMaterials)
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
    return catalogQuery(() =>
      this.database.db.transaction(async (tx) => {
        const [inserted] = await tx
          .insert(fabricMaterials)
          .values(input)
          .returning({ id: fabricMaterials.id });
        if (!inserted) throw new Error('Insert returned no catalog record.');
        const [row] = await tx
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
      }),
    );
  }
  update(id: string, input: UpdateFabricMaterial) {
    return catalogQuery(() =>
      this.database.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(fabricMaterials)
          .set(input)
          .where(eq(fabricMaterials.id, id))
          .returning({ id: fabricMaterials.id });
        if (!updated) return undefined;
        const [row] = await tx
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
      }),
    );
  }
  delete(id: string) {
    return catalogQuery(async () => {
      const [row] = await this.database.db
        .delete(fabricMaterials)
        .where(eq(fabricMaterials.id, id))
        .returning({ id: fabricMaterials.id });
      return row;
    }, true);
  }
}
