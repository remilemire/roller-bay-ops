import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  eq,
  getTableColumns,
  gte,
  ilike,
  isNull,
  isNotNull,
} from 'drizzle-orm';
import type { StockItemQuery } from '@roller-bay/shared/stock-items';
import { DatabaseService } from '../../database/database.service.js';
import { fabricColors } from '../fabric-catalog/colors/fabric-colors.table.js';
import { fabricMaterials } from '../fabric-catalog/materials/fabric-materials.table.js';
import { manufacturers } from '../fabric-catalog/manufacturers/manufacturers.table.js';
import { locations } from '../locations/levels/location-levels.table.js';
import { locationSections } from '../locations/sections/location-sections.table.js';
import { locationZones } from '../locations/zones/location-zones.table.js';
import { stockItems } from './stock-items.table.js';
import { stockItemsQuery } from './stock-items.persistence.js';

type StockItemsDatabase = Pick<
  DatabaseService['db'],
  'select' | 'insert' | 'update' | 'delete' | 'transaction'
>;
export type StockItemRecord = typeof stockItems.$inferSelect;
export type StockItemWrite = Omit<
  typeof stockItems.$inferInsert,
  'id' | 'createdAt' | 'updatedAt'
>;

@Injectable()
export class StockItemsRepository {
  private readonly db: StockItemsDatabase;
  constructor(@Inject(DatabaseService) connection: { db: StockItemsDatabase }) {
    this.db = connection.db;
  }

  withTransaction<T>(
    operation: (repository: StockItemsRepository) => Promise<T>,
  ): Promise<T> {
    return stockItemsQuery(() =>
      this.db.transaction((tx) =>
        operation(new StockItemsRepository({ db: tx })),
      ),
    );
  }

  list(query: StockItemQuery) {
    const where = and(
      query.isConsumed
        ? isNotNull(stockItems.consumedAt)
        : isNull(stockItems.consumedAt),
      query.fabricColorId
        ? eq(stockItems.fabricColorId, query.fabricColorId)
        : undefined,
      query.locationId
        ? eq(stockItems.locationId, query.locationId)
        : undefined,
      query.sectionId ? eq(locations.sectionId, query.sectionId) : undefined,
      query.zoneId ? eq(locationSections.zoneId, query.zoneId) : undefined,
      query.isRemnant !== undefined
        ? eq(stockItems.isRemnant, query.isRemnant)
        : undefined,
      query.minWidthMm !== undefined
        ? gte(stockItems.widthMm, query.minWidthMm.toFixed(3))
        : undefined,
      query.minRemainingLengthMm !== undefined
        ? gte(
            stockItems.remainingLengthMm,
            query.minRemainingLengthMm.toFixed(3),
          )
        : undefined,
      query.search
        ? ilike(
            fabricColors.code,
            `%${query.search.replace(/[\\%_]/g, '\\$&')}%`,
          )
        : undefined,
    );
    return stockItemsQuery(() =>
      this.db.transaction(
        async (tx) => {
          const repository = new StockItemsRepository({ db: tx });
          const items = await repository
            .select()
            .where(where)
            .orderBy(asc(stockItems.createdAt), asc(stockItems.id))
            .limit(query.pageSize)
            .offset((query.page - 1) * query.pageSize);
          const [result] = await tx
            .select({ total: count() })
            .from(stockItems)
            .innerJoin(
              fabricColors,
              eq(stockItems.fabricColorId, fabricColors.id),
            )
            .innerJoin(locations, eq(stockItems.locationId, locations.id))
            .innerJoin(
              locationSections,
              eq(locations.sectionId, locationSections.id),
            )
            .where(where);
          return { items, total: result!.total };
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      ),
    );
  }

  async findById(id: string) {
    return stockItemsQuery(async () => {
      const [row] = await this.select().where(eq(stockItems.id, id));
      return row;
    });
  }

  async findByIdForUpdate(id: string) {
    const [row] = await this.db
      .select()
      .from(stockItems)
      .where(eq(stockItems.id, id))
      .for('update');
    return row;
  }

  async findColor(id: string) {
    const [row] = await this.db
      .select({ id: fabricColors.id, thicknessMm: fabricColors.thicknessMm })
      .from(fabricColors)
      .where(eq(fabricColors.id, id));
    return row;
  }

  async create(input: StockItemWrite) {
    const [row] = await this.db
      .insert(stockItems)
      .values(input)
      .returning({ id: stockItems.id });
    if (!row) throw new Error('Insert returned no stock item.');
    return row.id;
  }

  async update(id: string, input: StockItemWrite) {
    await this.db.update(stockItems).set(input).where(eq(stockItems.id, id));
  }

  delete(id: string) {
    return stockItemsQuery(async () => {
      const [row] = await this.db
        .delete(stockItems)
        .where(eq(stockItems.id, id))
        .returning({ id: stockItems.id });
      return row;
    }, true);
  }

  private select() {
    return this.db
      .select({
        ...getTableColumns(stockItems),
        fabricColorCode: fabricColors.code,
        materialId: fabricMaterials.id,
        materialName: fabricMaterials.name,
        manufacturerId: manufacturers.id,
        manufacturerName: manufacturers.name,
        locationLabel: locations.label,
        sectionId: locationSections.id,
        sectionLabel: locationSections.label,
        zoneId: locationZones.id,
        zoneName: locationZones.name,
      })
      .from(stockItems)
      .innerJoin(fabricColors, eq(stockItems.fabricColorId, fabricColors.id))
      .innerJoin(
        fabricMaterials,
        eq(fabricColors.materialId, fabricMaterials.id),
      )
      .innerJoin(
        manufacturers,
        eq(fabricMaterials.manufacturerId, manufacturers.id),
      )
      .innerJoin(locations, eq(stockItems.locationId, locations.id))
      .innerJoin(locationSections, eq(locations.sectionId, locationSections.id))
      .innerJoin(locationZones, eq(locationSections.zoneId, locationZones.id));
  }
}
