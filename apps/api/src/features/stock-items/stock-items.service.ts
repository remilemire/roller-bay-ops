import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createStockItemSchema,
  stockItemSchema,
  type CreateStockItem,
  type StockItemQuery,
  type UpdateStockItem,
} from '@roller-bay/shared/stock-items';
import {
  StockItemsRepository,
  type StockItemRecord,
  type StockItemWrite,
} from './stock-items.repository.js';
import {
  InvalidStockItemError,
  StockItemInUseError,
  StockItemReferenceNotFoundError,
} from './stock-items.errors.js';

const nullableNumber = (value: string | null) =>
  value === null ? null : Number(value);

@Injectable()
export class StockItemsService {
  constructor(private readonly repository: StockItemsRepository) {}

  list(query: StockItemQuery) {
    return this.operation(async () => {
      const result = await this.repository.list(query);
      return {
        items: result.items.map((row) => this.toPublic(row)),
        total: result.total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }
  findById(id: string) {
    return this.operation(async () =>
      this.toPublic(await this.repository.findById(id)),
    );
  }

  create(input: CreateStockItem) {
    return this.operation(() =>
      this.repository.withTransaction(async (repository) => {
        if (input.sourceStockItemId) {
          const source = await repository.findById(input.sourceStockItemId);
          if (!source)
            throw new NotFoundException('Source stock item not found.');
          if (source.fabricColorId !== input.fabricColorId)
            throw new BadRequestException(
              'A remnant must have the same fabric color as its source.',
            );
        }
        const values = this.toWrite(input);
        if (input.radialDepthMm !== null)
          values.measurementThicknessMm = await this.thickness(
            repository,
            input.fabricColorId,
          );
        const id = await repository.create(values);
        return this.toPublic(await repository.findById(id));
      }),
    );
  }

  update(id: string, input: UpdateStockItem) {
    return this.operation(() =>
      this.repository.withTransaction(async (repository) => {
        // Validate the merged state under a row lock so partial updates cannot lose
        // another admin's measurement or undo their consumption/location change.
        const current = await repository.findByIdForUpdate(id);
        if (!current) throw new NotFoundException('Stock item not found.');
        const result = createStockItemSchema.safeParse({
          ...this.toInput(current),
          ...input,
        });
        if (!result.success)
          throw new BadRequestException({
            message: 'Validation failed',
            issues: result.error.issues,
          });
        const values = this.toWrite(result.data);
        values.measurementThicknessMm = current.measurementThicknessMm;
        if (input.radialDepthMm !== undefined) {
          values.measurementThicknessMm =
            input.radialDepthMm === null
              ? null
              : await this.thickness(repository, current.fabricColorId);
        }
        await repository.update(id, values);
        return this.toPublic(await repository.findById(id));
      }),
    );
  }

  delete(id: string) {
    return this.operation(async () => {
      if (!(await this.repository.delete(id)))
        throw new NotFoundException('Stock item not found.');
    });
  }

  private async thickness(repository: StockItemsRepository, colorId: string) {
    const color = await repository.findColor(colorId);
    if (!color) throw new NotFoundException('Fabric color not found.');
    return color.thicknessMm;
  }

  private toInput(row: StockItemRecord): CreateStockItem {
    return {
      fabricColorId: row.fabricColorId,
      isRemnant: row.isRemnant,
      widthMm: Number(row.widthMm),
      initialLengthMm: Number(row.initialLengthMm),
      explicitLengthMm: nullableNumber(row.explicitLengthMm),
      radialDepthMm: nullableNumber(row.radialDepthMm),
      tubeOuterDiameterMm: row.tubeOuterDiameterMm,
      locationId: row.locationId,
      sourceStockItemId: row.sourceStockItemId,
      isUsed: row.isUsed,
      consumedAt: row.consumedAt?.toISOString() ?? null,
    };
  }

  private toWrite(input: CreateStockItem): StockItemWrite {
    return {
      ...input,
      widthMm: input.widthMm.toFixed(3),
      initialLengthMm: input.initialLengthMm.toFixed(3),
      explicitLengthMm: input.explicitLengthMm?.toFixed(3) ?? null,
      radialDepthMm: input.radialDepthMm?.toFixed(3) ?? null,
      measurementThicknessMm: null,
      consumedAt: input.consumedAt === null ? null : new Date(input.consumedAt),
    };
  }

  private toPublic(row: Awaited<ReturnType<StockItemsRepository['findById']>>) {
    if (!row) throw new NotFoundException('Stock item not found.');
    return stockItemSchema.parse({
      ...row,
      ...this.toInput(row),
      measurementThicknessMm: nullableNumber(row.measurementThicknessMm),
      remainingLengthMm: Number(row.remainingLengthMm),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  }

  private async operation<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof StockItemReferenceNotFoundError)
        throw new NotFoundException(error.message);
      if (error instanceof StockItemInUseError)
        throw new ConflictException(error.message);
      if (error instanceof InvalidStockItemError)
        throw new BadRequestException(error.message);
      throw new ServiceUnavailableException('Stock storage is unavailable.');
    }
  }
}
