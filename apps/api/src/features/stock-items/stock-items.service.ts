import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { StockCorrection } from '@roller-bay/shared/corrections';
import type {
  StockCuttingOutcome,
  StockEffect,
} from '@roller-bay/shared/stock-items';
import {
  createStockItemSchema,
  stockItemSchema,
  type CreateStockItem,
  type StockItemQuery,
} from '@roller-bay/shared/stock-items';
import type { UnitOfWorkContext } from '../../unit-of-work/unit-of-work-context.js';
import { UnitOfWork } from '../../unit-of-work/unit-of-work.js';
import { AuditService, canonicalJson } from '../audit/index.js';
import { StockCorrectionsService } from './stock-corrections.service.js';
import {
  snapshotWrite,
  stockChanges,
  stockSnapshot,
} from './stock-items.audit.js';
import { recordCuttingResults } from './stock-items.cutting.js';
import { stockItemsOperation } from './stock-items.operation.js';
import { stockItemsQuery } from './stock-items.persistence.js';
import {
  StockItemsRepository,
  type StockItemRecord,
  type StockItemWrite,
} from './stock-items.repository.js';
const nullableNumber = (value: string | null) =>
  value === null ? null : Number(value);
export interface ReceiveRollLine {
  stockReceiptItemId: string;
  fabricColorId: string;
  widthMm: number;
  initialLengthMm: number;
  quantity: number;
  locationId: string;
}
@Injectable()
export class StockItemsService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly repository: StockItemsRepository,
    private readonly audit: AuditService,
    private readonly corrections: StockCorrectionsService,
  ) {}
  list(query: StockItemQuery) {
    return stockItemsOperation(async () => {
      const result = await this.unitOfWork.readOnlyTransaction(
        async (context) => context.stockItems.list(query),
      );
      return {
        items: result.items.map((row) => this.toPublic(row)),
        total: result.total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }
  findById(id: string) {
    return stockItemsOperation(async () =>
      this.toPublic(await this.repository.findById(id)),
    );
  }
  create(input: CreateStockItem, userId: string) {
    return stockItemsOperation(() =>
      this.unitOfWork.transaction(async (context) => {
        if (input.sourceStockItemId) {
          const source = await context.stockItems.findByIdForUpdate(
            input.sourceStockItemId,
          );
          if (!source)
            throw new NotFoundException('Source stock item not found.');
          if (source.voidedAt)
            throw new ConflictException('Voided stock cannot be a source.');
          if (source.fabricColorId !== input.fabricColorId)
            throw new BadRequestException(
              'A remnant must have the same fabric color as its source.',
            );
        }
        const values = this.toWrite(input);
        if (input.radialDepthMm !== null)
          values.measurementThicknessMm = await this.thickness(
            context.stockItems,
            input.fabricColorId,
          );
        const id = await context.stockItems.create(values);
        const created = (await context.stockItems.findById(id))!;
        await this.audit.record(
          context,
          userId,
          'stock.created',
          stockChanges([
            {
              calculationThicknessMm: null,
              stockItemId: id,
              sourceStockItemId: created.sourceStockItemId,
              before: null,
              after: stockSnapshot(created),
            },
          ]),
        );
        return this.toPublic(created);
      }),
    );
  }
  correct(id: string, request: StockCorrection, userId: string, key: string) {
    const input = request.changes;
    return stockItemsOperation(() =>
      this.unitOfWork.transaction(async (context) => {
        // Validate the merged state under a row lock so partial updates cannot lose
        // another admin's measurement or undo their consumption/location change.
        const current = await context.stockItems.findByIdForUpdate(id);
        if (!current) throw new NotFoundException('Stock item not found.');
        const audit = this.audit;
        const replay = await audit.replay(
          context,
          userId,
          'stock.correct',
          id,
          key,
          request,
        );
        if (replay.result) return replay.result;
        if (current.voidedAt)
          throw new ConflictException('Voided stock cannot be edited.');
        if (current.revision !== request.expectedRevision)
          throw new ConflictException(
            'Stock changed; refresh before correcting.',
          );
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
              : await this.thickness(context.stockItems, current.fabricColorId);
        }
        const before = stockSnapshot(current);
        if (
          canonicalJson({ ...snapshotWrite(before), ...values }) ===
          canonicalJson(snapshotWrite(before))
        )
          throw new BadRequestException('Provide an actual change.');
        await context.stockItems.update(id, values);
        const after = stockSnapshot((await context.stockItems.findById(id))!);
        const affectedAllocationIds = [
          ...new Set(
            (await context.stockItems.allocationReferences([id]))
              .filter((ref) => !ref.completedAt)
              .map((ref) => ref.allocationId),
          ),
        ].sort();
        const eventId = await audit.record(
          context,
          userId,
          'stock.corrected',
          stockChanges([
            {
              calculationThicknessMm: null,
              stockItemId: id,
              sourceStockItemId: after.sourceStockItemId,
              before,
              after,
            },
          ]),
          request.reason,
        );
        return audit.remember(
          context,
          userId,
          'stock.correct',
          id,
          key,
          replay.requestHash,
          {
            eventId,
            recordId: id,
            revision: after.revision,
            affectedAllocationIds,
            createdStockItemIds: [],
          },
        );
      }),
    );
  }
  /** Expand quantities into physical identities within the receipt's transaction. */
  receiveRolls(lines: ReceiveRollLine[], context: UnitOfWorkContext) {
    return stockItemsOperation(async () => {
      if (
        !lines.length ||
        lines.reduce((total, line) => total + line.quantity, 0) > 1000
      )
        throw new BadRequestException('Provide between 1 and 1,000 rolls.');
      const values = lines.flatMap((line) => {
        if (!Number.isInteger(line.quantity) || line.quantity < 1)
          throw new BadRequestException(
            'Roll quantities must be positive integers.',
          );
        const input = createStockItemSchema.parse({
          fabricColorId: line.fabricColorId,
          widthMm: line.widthMm,
          initialLengthMm: line.initialLengthMm,
          locationId: line.locationId,
        });
        return Array.from({ length: line.quantity }, () => ({
          ...this.toWrite(input),
          stockReceiptItemId: line.stockReceiptItemId,
        }));
      });
      const created = await context.stockItems.createReceivedRolls(values);
      return created.map((row) => ({
        calculationThicknessMm: null,
        stockItemId: row.id,
        sourceStockItemId: null,
        before: null,
        after: stockSnapshot(row),
      }));
    });
  }
  findByStockReceiptItemIds(ids: string[], context: UnitOfWorkContext) {
    return stockItemsOperation(async () =>
      (await context.stockItems.findByStockReceiptItemIds(ids)).map((row) =>
        this.toPublic(row),
      ),
    );
  }
  findForAllocation(
    context: UnitOfWorkContext,
    filter: {
      stockIds?: string[];
      colorIds?: string[];
      lock?: boolean;
    },
  ) {
    return stockItemsOperation(async () => {
      const rows = await context.stockItems.findForAllocation(filter);
      if (rows.length > 10000)
        throw new BadRequestException(
          'Too many candidate stock items; narrow the fabric requirements.',
        );
      return rows.map((row) => this.toPublic(row));
    });
  }
  async requireColors(ids: string[], context: UnitOfWorkContext) {
    if (!(await context.stockItems.colorsExist(ids)))
      throw new NotFoundException('A requested fabric color does not exist.');
  }
  async recordCuttingResults(
    outcomes: StockCuttingOutcome[],
    context: UnitOfWorkContext,
    now: Date,
  ) {
    return stockItemsOperation(async () => {
      const repository = context.stockItems;
      const previous = await repository.lockRows(
        outcomes.map((o) => o.stockItemId),
      );
      const { createdIds, calculationThickness } = await stockItemsQuery(() =>
        recordCuttingResults(repository, outcomes, now),
      );
      const before = new Map(previous.map((r) => [r.id, stockSnapshot(r)]));
      const effects: StockEffect[] = [];
      for (const id of [...previous.map((r) => r.id), ...createdIds]) {
        const row = (await repository.findById(id))!;
        effects.push({
          calculationThicknessMm: calculationThickness.get(id) ?? null,
          stockItemId: id,
          sourceStockItemId: row.sourceStockItemId,
          before: before.get(id) ?? null,
          after: stockSnapshot(row),
        });
      }
      return effects;
    });
  }
  void(
    id: string,
    input: {
      expectedRevision: number;
      reason: string;
    },
    userId: string,
    key: string,
  ) {
    return stockItemsOperation(() =>
      this.unitOfWork.transaction(async (context) => {
        const row = await context.stockItems.findByIdForUpdate(id);
        if (!row) throw new NotFoundException('Stock item not found.');
        const audit = this.audit;
        const replay = await audit.replay(
          context,
          userId,
          'stock.void',
          id,
          key,
          input,
        );
        if (replay.result) return replay.result;
        if (row.revision !== input.expectedRevision || row.voidedAt)
          throw new ConflictException('Stock changed or was already voided.');
        if (
          row.stockReceiptItemId ||
          (await context.stockItems.creationAllocation(id))
        )
          throw new ConflictException(
            'Void this stock through its originating receipt or cutting result.',
          );
        if (
          (await context.stockItems.allocationReferences([id])).length ||
          (await context.stockItems.descendants([id])).length
        )
          throw new ConflictException(
            'Reserved stock or stock with downstream use cannot be voided.',
          );
        const before = stockSnapshot(row);
        const effects = await this.corrections.applySnapshots(context, [
          { before, value: { ...before, voidedAt: new Date().toISOString() } },
        ]);
        const eventId = await audit.record(
          context,
          userId,
          'stock.voided',
          stockChanges(effects),
          input.reason,
        );
        return audit.remember(
          context,
          userId,
          'stock.void',
          id,
          key,
          replay.requestHash,
          {
            eventId,
            recordId: id,
            revision: effects[0]!.after.revision,
            affectedAllocationIds: [],
            createdStockItemIds: [],
          },
        );
      }),
    );
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
      tubeOuterDiameterMm: nullableNumber(row.tubeOuterDiameterMm),
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
      tubeOuterDiameterMm: input.tubeOuterDiameterMm?.toFixed(3) ?? null,
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
      voidedAt: row.voidedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  }
}
