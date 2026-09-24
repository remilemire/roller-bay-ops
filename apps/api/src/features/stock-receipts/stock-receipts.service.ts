import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  createStockReceiptSchema,
  stockReceiptDraftDataSchema,
  type CreateStockReceipt,
  type StockReceiptDraftData,
  type StockReceiptQuery,
} from '@roller-bay/shared/stock-receipts';
import { createHash } from 'node:crypto';
import type { UnitOfWorkContext } from '../../unit-of-work/unit-of-work-context.js';
import { UnitOfWork } from '../../unit-of-work/unit-of-work.js';
import { AuditService } from '../audit/index.js';
import { stockChanges, StockItemsService } from '../stock-items/index.js';
import {
  receiptFormData,
  receiptSummary,
  StockReceiptDetailsService,
} from './stock-receipt-details.service.js';
import { stockReceiptsOperation } from './stock-receipts.operation.js';
import {
  StockReceiptsRepository,
  type StockReceiptRecord,
} from './stock-receipts.repository.js';
const hash = (input: unknown) =>
  createHash('sha256').update(JSON.stringify(input)).digest('hex');
@Injectable()
export class StockReceiptsService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly audit: AuditService,
    private readonly stockItems: StockItemsService,
    private readonly details: StockReceiptDetailsService,
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
    return stockReceiptsOperation(() =>
      this.unitOfWork.transaction(async (context) => {
        // Claim the creator/key pair in the same transaction as its contents.
        // Concurrent retries then reuse the committed receipt instead of adding rolls.
        const header = await context.stockReceipts.create({
          purchaseOrderNumber: data.purchaseOrderNumber,
          createdByUserId: userId,
          idempotencyKey: key,
          requestHash,
        });
        if (!header) {
          const existing = await context.stockReceipts.findByKey(userId, key);
          if (!existing || existing.requestHash !== requestHash)
            throw new ConflictException(
              'This Idempotency-Key was already used with a different stock receipt.',
            );
          return this.details.load(context, existing);
        }
        await this.writeLines(context.stockReceipts, header.id, data);
        // Drafts stay out of history, which begins at submission.
        if (draft) return this.details.load(context, header);
        return this.submitRecords(context, header, userId, false);
      }),
    );
  }
  updateDraft(id: string, revision: number, data: StockReceiptDraftData) {
    return stockReceiptsOperation(() =>
      this.unitOfWork.transaction(async (context) => {
        this.requireDraft(
          await context.stockReceipts.findById(id, true),
          revision,
        );
        await context.stockReceipts.deleteItems(id);
        await this.writeLines(context.stockReceipts, id, data);
        const header = await context.stockReceipts.update(id, {
          purchaseOrderNumber: data.purchaseOrderNumber,
        });
        return this.details.load(context, header);
      }),
    );
  }
  deleteDraft(id: string, revision: number) {
    return stockReceiptsOperation(() =>
      this.unitOfWork.transaction(async (context) => {
        this.requireDraft(
          await context.stockReceipts.findById(id, true),
          revision,
        );
        await context.stockReceipts.deleteItems(id);
        await context.stockReceipts.delete(id);
      }),
    );
  }
  submitDraft(id: string, revision: number, userId: string) {
    return stockReceiptsOperation(() =>
      this.unitOfWork.transaction(async (context) => {
        const header = await context.stockReceipts.findById(id, true);
        if (!header) throw new NotFoundException('Stock receipt not found.');
        // A successful commit may have lost its response. Replay that draft
        // revision before rejecting changes to an already submitted receipt.
        if (!header.isDraft && header.submittedDraftRevision === revision)
          return this.details.load(context, header);
        this.requireDraft(header, revision);
        return this.submitRecords(context, header, userId, true);
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
    context: UnitOfWorkContext,
    header: StockReceiptRecord,
    userId: string,
    fromDraft: boolean,
  ) {
    const lines = await context.stockReceipts.findItems(header.id);
    const parsed = createStockReceiptSchema.safeParse(
      receiptFormData(header, lines),
    );
    if (!parsed.success)
      throw new BadRequestException({
        message: 'Complete all receipt fields before submitting.',
        issues: parsed.error.issues,
      });
    const effects = await this.stockItems.receiveRolls(
      parsed.data.items.map((line, index) => ({
        ...line,
        stockReceiptItemId: lines[index]!.id,
      })),
      context,
    );
    const saved = await context.stockReceipts.update(
      header.id,
      {
        stockEffects: effects,
        isDraft: false,
        submittedAt: new Date(),
        submittedByUserId: userId,
        submittedDraftRevision: fromDraft ? header.revision : null,
      },
      fromDraft,
    );
    const result = await this.details.submitted(context, saved);
    await this.audit.record(context, userId, 'receipt.submitted', [
      {
        recordType: 'stock-receipts',
        recordId: header.id,
        // The draft it may have come from is not part of its history.
        before: null,
        after: { type: 'stock-receipts', value: result },
      },
      ...stockChanges(effects),
    ]);
    return result;
  }
  list(query: StockReceiptQuery) {
    return stockReceiptsOperation(() =>
      this.unitOfWork.readOnlyTransaction(async (context) => {
        const result = await context.stockReceipts.list(query);
        return {
          ...result,
          items: result.items.map((item) => receiptSummary(item)),
        };
      }),
    );
  }
  findById(id: string) {
    return stockReceiptsOperation(() =>
      this.unitOfWork.readOnlyTransaction(async (context) => {
        const header = await context.stockReceipts.findById(id);
        if (!header) throw new NotFoundException('Stock receipt not found.');
        return this.details.load(context, header);
      }),
    );
  }
}
