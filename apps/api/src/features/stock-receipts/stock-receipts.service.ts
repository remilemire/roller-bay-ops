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
  stockReceiptSummarySchema,
  stockReceiptSchema,
  stockReceiptDetailSchema,
  type CreateStockReceipt,
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
  StockReceiptReferenceNotFoundError,
} from './stock-receipts.errors.js';

@Injectable()
export class StockReceiptsService {
  constructor(
    private readonly repository: StockReceiptsRepository,
    private readonly stockItems: StockItemsService,
  ) {}

  create(input: CreateStockReceipt, userId: string, key: string) {
    // Hash validated, normalized input, including the default quantity. JSON property
    // order is fixed by the shared schema, independent of the incoming JSON order.
    const requestHash = createHash('sha256')
      .update(JSON.stringify(input))
      .digest('hex');
    return this.operation(() =>
      this.repository.withTransaction(async (repository, tx) => {
        const created = await repository.create({
          purchaseOrderNumber: input.purchaseOrderNumber,
          submittedByUserId: userId,
          idempotencyKey: key,
          requestHash,
        });
        if (!created) {
          // The unique insert waits for an in-flight submission. At read committed,
          // this subsequent read sees its receipt once that transaction commits.
          const existing = await repository.findByKey(userId, key);
          if (!existing) throw new Error('Conflicting receipt was not found.');
          if (existing.requestHash !== requestHash)
            throw new ConflictException(
              'This Idempotency-Key was already used with a different stock receipt.',
            );
          return this.receipt(repository, tx, existing);
        }
        const lines = await repository.createItems(
          input.items.map((item) => ({
            stockReceiptId: created.id,
            fabricColorId: item.fabricColorId,
            widthMm: item.widthMm.toFixed(3),
            initialLengthMm: item.initialLengthMm.toFixed(3),
            quantity: item.quantity,
            locationId: item.locationId,
          })),
        );
        await this.stockItems.receiveRolls(
          lines.map((line) => ({
            stockReceiptItemId: line.id,
            fabricColorId: line.fabricColorId,
            widthMm: Number(line.widthMm),
            initialLengthMm: Number(line.initialLengthMm),
            quantity: line.quantity,
            locationId: line.locationId,
          })),
          tx,
        );
        return this.receipt(repository, tx, created);
      }),
    );
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
        const receipt = await this.receipt(repository, tx, header, true);
        return receipt;
      }, true),
    );
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
    return stockReceiptSummarySchema.parse({
      ...row,
      submittedAt: row.submittedAt.toISOString(),
    });
  }

  private async operation<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof HttpException) throw error;
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
