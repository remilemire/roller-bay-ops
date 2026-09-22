import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  CorrectionEligibility,
  StockCorrection,
} from '@roller-bay/shared/corrections';
import type {
  StockCuttingOutcome,
  StockEffect,
  StockSnapshot,
} from '@roller-bay/shared/stock-items';
import {
  createStockItemSchema,
  stockItemSchema,
  type CreateStockItem,
  type StockItemQuery,
} from '@roller-bay/shared/stock-items';
import type { UnitOfWorkContext } from '../../unit-of-work/unit-of-work-context.js';
import { UnitOfWork } from '../../unit-of-work/unit-of-work.js';
import { AuditService, canonicalJson } from '../audit/audit.service.js';
import {
  snapshotWrite,
  stockChanges,
  stockSnapshot,
} from './stock-items.audit.js';
import { recordCuttingResults } from './stock-items.cutting.js';
import {
  InvalidStockItemError,
  StockItemInUseError,
  StockItemReferenceNotFoundError,
} from './stock-items.errors.js';
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
  ) {}
  list(query: StockItemQuery) {
    return this.operation(async () => {
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
    return this.operation(async () =>
      this.toPublic(await this.repository.findById(id)),
    );
  }
  create(input: CreateStockItem, userId: string) {
    return this.operation(() =>
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
    return this.operation(() =>
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
    return this.operation(async () => {
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
    return this.operation(async () =>
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
    return this.operation(async () => {
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
    return this.operation(async () => {
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
  async lockForCorrection(context: UnitOfWorkContext, ids: string[]) {
    const repository = context.stockItems;
    return this.operation(async () =>
      (await repository.lockRows(ids)).map(stockSnapshot),
    );
  }
  async eligibility(
    context: UnitOfWorkContext,
    effects: StockEffect[],
    ids: string[],
    excludeAllocationId?: string,
  ): Promise<CorrectionEligibility[]> {
    const repository = context.stockItems;
    const refs = await repository.allocationReferences(ids);
    const children = await repository.descendants(ids);
    const baseline = new Map(effects.map((e) => [e.stockItemId, e]));
    const results: CorrectionEligibility[] = [];
    for (const id of ids) {
      const row = await repository.findById(id);
      if (!row) throw new NotFoundException('Stock item not found.');
      const blockers: CorrectionEligibility['blockers'] = [];
      const add = (
        code: CorrectionEligibility['blockers'][number]['code'],
        message: string,
        allocationIds: string[] = [],
        stockItemIds: string[] = [],
      ) => blockers.push({ code, message, allocationIds, stockItemIds });
      const effect = baseline.get(id);
      if (!effect)
        add(
          'legacy',
          'No trustworthy historical stock baseline exists. Use a current-stock adjustment.',
        );
      else if (effect.after.revision !== row.revision)
        add(
          'changed',
          'Stock changed after this workflow. Use a current-stock adjustment.',
        );
      if (row.voidedAt) add('voided', 'This stock record is voided.');
      const active = refs
        .filter((r) => r.stockItemId === id && !r.completedAt)
        .map((r) => r.allocationId);
      const completed = refs
        .filter(
          (r) =>
            r.stockItemId === id &&
            r.completedAt &&
            r.allocationId !== excludeAllocationId &&
            (!effect ||
              r.completedAt.getTime() >
                new Date(effect.after.updatedAt).getTime()),
        )
        .map((r) => r.allocationId);
      const downstream = children
        .filter((r) => r.sourceStockItemId === id && !baseline.has(r.id))
        .map((r) => r.id);
      if (active.length)
        add(
          'reserved',
          'Release or reassign reservations before correcting.',
          active,
        );
      if (completed.length || downstream.length)
        add(
          'downstream',
          'Later production or retained pieces depend on this stock.',
          completed,
          downstream,
        );
      results.push({ stockItemId: id, revision: row.revision, blockers });
    }
    return results;
  }
  async requireCorrectionEligible(
    context: UnitOfWorkContext,
    effects: StockEffect[],
    versions: {
      stockItemId: string;
      expectedRevision: number;
    }[],
    ids: string[],
    excludeAllocationId?: string,
  ) {
    const expected = new Map(
      versions.map((v) => [v.stockItemId, v.expectedRevision]),
    );
    if (expected.size !== versions.length)
      throw new BadRequestException('Duplicate stock revision.');
    const eligibility = await this.eligibility(
      context,
      effects,
      ids,
      excludeAllocationId,
    );
    for (const item of eligibility) {
      if (item.blockers.length)
        throw new ConflictException({
          message: 'Some stock cannot be corrected.',
          issues: item.blockers.map((b) => ({
            code: b.code,
            path: `stock.${item.stockItemId}`,
            message: b.message,
          })),
        });
      if (expected.get(item.stockItemId) !== item.revision)
        throw new ConflictException(
          'Stock changed; refresh before correcting.',
        );
    }
  }
  async applySnapshots(
    context: UnitOfWorkContext,
    changes: {
      before: StockSnapshot | null;
      value: StockSnapshot | StockItemWrite;
    }[],
  ): Promise<StockEffect[]> {
    const repository = context.stockItems;
    const effects: StockEffect[] = [];
    for (const change of changes) {
      const write =
        'id' in change.value ? snapshotWrite(change.value) : change.value;
      const id = change.before?.id ?? (await repository.create(write));
      if (change.before) await repository.update(id, write);
      const after = stockSnapshot((await repository.findById(id))!);
      effects.push({
        calculationThicknessMm: null,
        stockItemId: id,
        sourceStockItemId: after.sourceStockItemId,
        before: change.before,
        after,
      });
    }
    return effects;
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
    return this.operation(() =>
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
        const effects = await this.applySnapshots(context, [
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
  private async operation<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await stockItemsQuery(operation);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof StockItemReferenceNotFoundError)
        throw new NotFoundException(error.message, { cause: error });
      if (error instanceof StockItemInUseError)
        throw new ConflictException(error.message, { cause: error });
      if (error instanceof InvalidStockItemError)
        throw new BadRequestException(error.message, { cause: error });
      throw new ServiceUnavailableException('Stock storage is unavailable.', {
        cause: error,
      });
    }
  }
}
