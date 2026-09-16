import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createStockReceiptSchema,
  stockReceiptDraftDataSchema,
  stockReceiptDraftSchema,
  stockReceiptDraftSummarySchema,
  stockReceiptSummarySchema,
  stockReceiptSchema,
  stockReceiptDetailSchema,
  type CreateStockReceipt,
  type StockReceiptDraftData,
  type StockReceiptQuery,
} from '@roller-bay/shared/stock-receipts';
import type { DatabaseTransaction } from '../../database/database.service.js';
import { StockItemsService } from '../stock-items/stock-items.service.js';
import {
  StockReceiptsRepository,
  type StockReceiptRecord,
} from './stock-receipts.repository.js';
import {
  InvalidStockReceiptError,
  StockReceiptConflictError,
  StockReceiptReferenceNotFoundError,
} from './stock-receipts.errors.js';

const hash = (input: unknown) =>
  createHash('sha256').update(JSON.stringify(input)).digest('hex');

@Injectable()
export class StockReceiptsService {
  constructor(
    private readonly repository: StockReceiptsRepository,
    private readonly stockItems: StockItemsService,
  ) {}

  create(input: CreateStockReceipt, userId: string, key: string) {
    return this.createRecord(
      stockReceiptDraftDataSchema.parse(input),
      userId,
      key,
      hash(input),
      false,
    );
  }

  createDraft(data: StockReceiptDraftData, userId: string, key: string) {
    return this.createRecord(
      data,
      userId,
      key,
      hash({ mode: 'draft', data }),
      true,
    );
  }

  private createRecord(
    data: StockReceiptDraftData,
    userId: string,
    key: string,
    requestHash: string,
    draft: boolean,
  ) {
    return this.operation(() =>
      this.repository.withTransaction(async (repository, tx) => {
        const header = await repository.create({
          purchaseOrderNumber: data.purchaseOrderNumber,
          createdByUserId: userId,
          idempotencyKey: key,
          requestHash,
        });
        if (!header) {
          const existing = await repository.findByKey(userId, key);
          if (!existing || existing.requestHash !== requestHash)
            throw new ConflictException(
              'This Idempotency-Key was already used with a different stock receipt.',
            );
          return this.detail(repository, tx, existing);
        }
        await this.writeLines(repository, header.id, data);
        if (draft) return this.detail(repository, tx, header);
        return this.submitRecords(repository, tx, header, userId, false);
      }),
    );
  }

  updateDraft(id: string, revision: number, data: StockReceiptDraftData) {
    return this.operation(() =>
      this.repository.withTransaction(async (repository, tx) => {
        this.requireDraft(await repository.findById(id, true), revision);
        await repository.deleteItems(id);
        await this.writeLines(repository, id, data);
        const header = await repository.update(id, {
          purchaseOrderNumber: data.purchaseOrderNumber,
        });
        return this.detail(repository, tx, header);
      }),
    );
  }

  deleteDraft(id: string, revision: number) {
    return this.operation(() =>
      this.repository.withTransaction(async (repository) => {
        this.requireDraft(await repository.findById(id, true), revision);
        await repository.deleteItems(id);
        await repository.delete(id);
      }),
    );
  }

  submitDraft(id: string, revision: number, userId: string) {
    return this.operation(() =>
      this.repository.withTransaction(async (repository, tx) => {
        const header = await repository.findById(id, true);
        if (!header) throw new NotFoundException('Stock receipt not found.');
        if (!header.isDraft && header.submittedDraftRevision === revision)
          return this.detail(repository, tx, header);
        this.requireDraft(header, revision);
        return this.submitRecords(repository, tx, header, userId, true);
      }),
    );
  }

  private requireDraft(
    header: StockReceiptRecord | undefined,
    revision: number,
  ) {
    if (!header) throw new NotFoundException('Stock receipt not found.');
    if (!header.isDraft)
      throw new ConflictException(
        'Only draft receipts can be changed or submitted.',
      );
    if (header.revision !== revision)
      throw new ConflictException(
        'Receipt changed; refresh before submitting.',
      );
    return header;
  }

  private writeLines(
    repository: StockReceiptsRepository,
    id: string,
    data: StockReceiptDraftData,
  ) {
    return repository.createItems(
      data.items.map((line, index) => ({
        stockReceiptId: id,
        position: index + 1,
        fabricColorId: line.fabricColorId,
        widthMm: line.widthMm?.toFixed(3) ?? null,
        initialLengthMm: line.initialLengthMm?.toFixed(3) ?? null,
        quantity: line.quantity,
        locationId: line.locationId,
      })),
    );
  }

  // Both direct submission and draft submission use the persisted, ordered lines.
  private async submitRecords(
    repository: StockReceiptsRepository,
    tx: DatabaseTransaction,
    header: StockReceiptRecord,
    userId: string,
    fromDraft: boolean,
  ) {
    const lines = await repository.findItems(header.id);
    const parsed = createStockReceiptSchema.safeParse(
      this.formData(header, lines),
    );
    if (!parsed.success)
      throw new BadRequestException({
        message: 'Complete all receipt fields before submitting.',
        issues: parsed.error.issues,
      });
    await this.stockItems.receiveRolls(
      parsed.data.items.map((line, index) => ({
        ...line,
        stockReceiptItemId: lines[index]!.id,
      })),
      tx,
    );
    const saved = await repository.update(
      header.id,
      {
        isDraft: false,
        submittedAt: new Date(),
        submittedByUserId: userId,
        submittedDraftRevision: fromDraft ? header.revision : null,
      },
      fromDraft,
    );
    return this.receipt(repository, tx, saved);
  }

  list(query: StockReceiptQuery) {
    return this.operation(() =>
      this.repository.withTransaction(async (repository) => {
        const result = await repository.list(query);
        return {
          ...result,
          items: result.items.map((item) => this.toPublic(item)),
        };
      }, true),
    );
  }

  findById(id: string) {
    return this.operation(() =>
      this.repository.withTransaction(async (repository, tx) => {
        const header = await repository.findById(id);
        if (!header) throw new NotFoundException('Stock receipt not found.');
        return this.detail(repository, tx, header, true);
      }, true),
    );
  }

  private formData(
    header: StockReceiptRecord,
    lines: Awaited<ReturnType<StockReceiptsRepository['findItems']>>,
  ) {
    return {
      purchaseOrderNumber: header.purchaseOrderNumber,
      items: lines.map((line) => ({
        fabricColorId: line.fabricColorId,
        widthMm: line.widthMm === null ? null : Number(line.widthMm),
        initialLengthMm:
          line.initialLengthMm === null ? null : Number(line.initialLengthMm),
        quantity: line.quantity,
        locationId: line.locationId,
      })),
    };
  }

  private async detail(
    repository: StockReceiptsRepository,
    tx: DatabaseTransaction,
    header: StockReceiptRecord,
    includeStock = false,
  ) {
    if (!header.isDraft)
      return this.receipt(repository, tx, header, includeStock);
    return stockReceiptDraftSchema.parse({
      ...this.toPublic(header),
      data: this.formData(header, await repository.findItems(header.id)),
    });
  }

  private async receipt(
    repository: StockReceiptsRepository,
    tx: DatabaseTransaction,
    header: StockReceiptRecord,
    detail = false,
  ) {
    const lines = await repository.findItems(header.id);
    const stock = await this.stockItems.findByStockReceiptItemIds(
      lines.map((line) => line.id),
      tx,
    );
    const result = {
      ...this.toPublic(header),
      items: lines.map((line) => {
        const rolls = stock.filter(
          (item) => item.stockReceiptItemId === line.id,
        );
        return {
          ...line,
          widthMm: Number(line.widthMm),
          initialLengthMm: Number(line.initialLengthMm),
          stockItemIds: rolls.map((item) => item.id),
          ...(detail ? { stockItems: rolls } : {}),
        };
      }),
    };
    return detail
      ? stockReceiptDetailSchema.parse(result)
      : stockReceiptSchema.parse(result);
  }

  private toPublic(row: StockReceiptRecord) {
    const result = {
      ...row,
      state: row.isDraft ? 'draft' : 'submitted',
      submittedAt: row.submittedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
    return !row.isDraft
      ? stockReceiptSummarySchema.parse(result)
      : stockReceiptDraftSummarySchema.parse(result);
  }

  private async operation<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof StockReceiptConflictError)
        throw new ConflictException(error.message);
      if (error instanceof StockReceiptReferenceNotFoundError)
        throw new NotFoundException(error.message);
      if (error instanceof InvalidStockReceiptError)
        throw new BadRequestException(error.message);
      throw new ServiceUnavailableException(
        'Stock-receipt storage is unavailable.',
      );
    }
  }
}
