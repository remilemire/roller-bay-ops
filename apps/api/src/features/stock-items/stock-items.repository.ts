import { allocations } from '../allocations/tables/allocations.table.js';
import { allocationItems } from '../allocations/tables/allocation-items.table.js';
import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  sql,
  asc,
  count,
  eq,
  getTableColumns,
  gte,
  ilike,
  or,
  inArray,
  isNull,
  isNotNull,
} from 'drizzle-orm';
import type { StockItemQuery } from '@roller-bay/shared/stock-items';
import {
  DatabaseService,
  type DatabaseTransaction,
} from '../../database/database.service.js';
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
  'id' | 'createdAt' | 'updatedAt' | 'revision'
>;

@Injectable()
export class StockItemsRepository {
  private readonly db: StockItemsDatabase;
  constructor(@Inject(DatabaseService) connection: { db: StockItemsDatabase }) {
    this.db = connection.db;
  }

  withTransaction<T>(
    operation: (
      repository: StockItemsRepository,
      tx: DatabaseTransaction,
    ) => Promise<T>,
  ): Promise<T> {
    return stockItemsQuery(() =>
      this.db.transaction((tx) =>
        operation(new StockItemsRepository({ db: tx }), tx),
      ),
    );
  }

  list(query: StockItemQuery) {
    const containsPattern = (search: string) =>
      `%${search.replace(/[\\%_]/g, '\\$&')}%`;
    const where = and(
      query.isVoided
        ? isNotNull(stockItems.voidedAt)
        : isNull(stockItems.voidedAt),
      !query.isVoided
        ? query.isConsumed
          ? isNotNull(stockItems.consumedAt)
          : isNull(stockItems.consumedAt)
        : undefined,
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
      // Rolls are referred to by color code or by the ID shown on screen.
      query.search
        ? or(
            ilike(fabricColors.code, containsPattern(query.search)),
            ilike(sql`${stockItems.id}::text`, containsPattern(query.search)),
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

  async creationAllocation(id: string) {
    const [row] = await this.db
      .select({ id: allocations.id })
      .from(allocations)
      .where(
        sql`${allocations.stockEffects} @> ${JSON.stringify([{ stockItemId: id, before: null }])}::jsonb OR ${allocations.completion}->'createdStockItemIds' @> ${JSON.stringify([id])}::jsonb`,
      )
      .limit(1);
    return row;
  }
  async allocationReferences(ids: string[]) {
    if (!ids.length) return [];
    return this.db
      .select({
        allocationId: allocations.id,
        stockItemId: allocationItems.stockItemId,
        completedAt: allocations.completedAt,
        cancelledAt: allocations.cancelledAt,
      })
      .from(allocationItems)
      .innerJoin(allocations, eq(allocationItems.allocationId, allocations.id))
      .where(
        and(
          inArray(allocationItems.stockItemId, ids),
          eq(allocations.isDraft, false),
          isNull(allocations.cancelledAt),
        ),
      );
  }
  async lockRows(ids: string[]) {
    if (!ids.length) return [];
    return this.db
      .select()
      .from(stockItems)
      .where(inArray(stockItems.id, ids))
      .orderBy(asc(stockItems.id))
      .for('update');
  }
  async descendants(ids: string[]) {
    return ids.length
      ? this.db
          .select({
            id: stockItems.id,
            sourceStockItemId: stockItems.sourceStockItemId,
          })
          .from(stockItems)
          .where(inArray(stockItems.sourceStockItemId, ids))
      : [];
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
    await this.db
      .update(stockItems)
      .set({
        ...input,
        revision: sql`${stockItems.revision} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(stockItems.id, id));
  }

  async createReceivedRolls(
    transaction: DatabaseTransaction,
    values: StockItemWrite[],
  ) {
    return stockItemsQuery(() =>
      transaction.insert(stockItems).values(values).returning({
        id: stockItems.id,
        stockReceiptItemId: stockItems.stockReceiptItemId,
      }),
    );
  }

  async findByStockReceiptItemIds(
    ids: string[],
    transaction: DatabaseTransaction,
  ) {
    if (ids.length === 0) return [];
    return stockItemsQuery(() =>
      this.select(transaction)
        .where(inArray(stockItems.stockReceiptItemId, ids))
        .orderBy(asc(stockItems.id)),
    );
  }

  async findForAllocation(
    transaction: DatabaseTransaction,
    filter: { stockIds?: string[]; colorIds?: string[]; lock?: boolean },
  ) {
    if (filter.stockIds?.length === 0 || filter.colorIds?.length === 0)
      return [];
    const where = and(
      filter.stockIds ? inArray(stockItems.id, filter.stockIds) : undefined,
      filter.colorIds
        ? inArray(stockItems.fabricColorId, filter.colorIds)
        : undefined,
      filter.colorIds ? isNull(stockItems.consumedAt) : undefined,
      filter.colorIds ? isNull(stockItems.voidedAt) : undefined,
    );
    // Lock stock alone before loading joined labels. A common ID order avoids
    // reversed lock acquisition when allocations share several stock items.
    if (filter.lock)
      await transaction
        .select({ id: stockItems.id })
        .from(stockItems)
        .where(where)
        .orderBy(asc(stockItems.id))
        .for('update');
    return this.select(transaction)
      .where(where)
      .orderBy(asc(stockItems.id))
      .limit(10001);
  }

  async colorsExist(ids: string[], transaction: DatabaseTransaction) {
    if (!ids.length) return true;
    const rows = await transaction
      .select({ id: fabricColors.id })
      .from(fabricColors)
      .where(inArray(fabricColors.id, ids));
    return rows.length === new Set(ids).size;
  }

  private select(db: StockItemsDatabase = this.db) {
    return db
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
