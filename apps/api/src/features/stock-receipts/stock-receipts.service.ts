import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  receiptCorrectionContextSchema,
  type ReceiptCorrection,
} from '@roller-bay/shared/corrections';
import type { StockEffect } from '@roller-bay/shared/stock-items';
import {
  createStockReceiptSchema,
  stockReceiptDetailSchema,
  stockReceiptDraftDataSchema,
  stockReceiptDraftSchema,
  stockReceiptDraftSummarySchema,
  stockReceiptSummarySchema,
  type CreateStockReceipt,
  type StockReceiptDraftData,
  type StockReceiptQuery,
} from '@roller-bay/shared/stock-receipts';
import { createHash } from 'node:crypto';
import type { UnitOfWorkContext } from '../../unit-of-work/unit-of-work-context.js';
import { UnitOfWork } from '../../unit-of-work/unit-of-work.js';
import { AuditService } from '../audit/audit.service.js';
import { stockChanges } from '../stock-items/stock-items.audit.js';
import { StockCorrectionsService } from '../stock-items/stock-corrections.service.js';
import { StockItemsService } from '../stock-items/stock-items.service.js';
import {
  InvalidStockReceiptError,
  StockReceiptConflictError,
  StockReceiptReferenceNotFoundError,
} from './stock-receipts.errors.js';
import { stockReceiptsQuery } from './stock-receipts.persistence.js';
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
    private readonly stockCorrections: StockCorrectionsService,
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
          return this.detail(context, existing);
        }
        await this.writeLines(context.stockReceipts, header.id, data);
        // Drafts stay out of history, which begins at submission.
        if (draft) return this.detail(context, header);
        return this.submitRecords(context, header, userId, false);
      }),
    );
  }
  updateDraft(id: string, revision: number, data: StockReceiptDraftData) {
    return this.operation(() =>
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
        return this.detail(context, header);
      }),
    );
  }
  deleteDraft(id: string, revision: number) {
    return this.operation(() =>
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
    return this.operation(() =>
      this.unitOfWork.transaction(async (context) => {
        const header = await context.stockReceipts.findById(id, true);
        if (!header) throw new NotFoundException('Stock receipt not found.');
        // A successful commit may have lost its response. Replay that draft
        // revision before rejecting changes to an already submitted receipt.
        if (!header.isDraft && header.submittedDraftRevision === revision)
          return this.detail(context, header);
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
      this.formData(header, lines),
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
    const result = await this.receipt(context, saved);
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
  correctionContext(id: string) {
    return this.operation(() =>
      this.unitOfWork.readOnlyTransaction(async (context) => {
        const header = await context.stockReceipts.findById(id);
        if (!header) throw new NotFoundException('Stock receipt not found.');
        if (header.isDraft)
          throw new ConflictException(
            'Submit the receipt before correcting it.',
          );
        const record = await this.receipt(context, header);
        const ids = record.items.flatMap((i) => i.stockItemIds);
        return receiptCorrectionContextSchema.parse({
          record,
          baselineAvailable: header.stockEffects !== null,
          eligibility: await this.stockCorrections.eligibility(
            context,
            header.stockEffects ?? [],
            ids,
          ),
        });
      }),
    );
  }
  correct(id: string, input: ReceiptCorrection, userId: string, key: string) {
    return this.operation(() =>
      this.unitOfWork.transaction(async (context) => {
        const header = await context.stockReceipts.findById(id, true);
        if (!header) throw new NotFoundException('Stock receipt not found.');
        const audit = this.audit;
        const replay = await audit.replay(
          context,
          userId,
          'receipt.correct',
          id,
          key,
          input,
        );
        if (replay.result) return replay.result;
        if (header.isDraft || header.revision !== input.expectedRevision)
          throw new ConflictException('Receipt changed or is still a draft.');
        if (input.operations.length && header.stockEffects === null)
          throw new ConflictException(
            'This older receipt lacks a trustworthy stock baseline. Use a current-stock adjustment.',
          );
        const before = await this.receipt(context, header);
        const lines = await context.stockReceipts.findItems(id);
        const operated = input.operations.flatMap((op) =>
          op.action === 'add' ? [] : [op.lineId],
        );
        if (new Set(operated).size !== operated.length)
          throw new BadRequestException('Correct each receipt line only once.');
        // Paperwork and quantity increases do not lock unrelated existing rolls.
        const affectedStockIds = input.operations.flatMap((op) => {
          if (op.action === 'add') return [];
          const line = before.items.find((line) => line.id === op.lineId);
          if (!line || line.voidedAt)
            throw new BadRequestException(
              'Select an active line from this receipt.',
            );
          const allRolls = line.stockItems
            .filter((stock) => !stock.voidedAt)
            .map((stock) => stock.id);
          if (op.action === 'remove') return allRolls;
          const dimensionsChanged =
            op.data.fabricColorId !== line.fabricColorId ||
            op.data.widthMm !== line.widthMm ||
            op.data.initialLengthMm !== line.initialLengthMm ||
            op.data.locationId !== line.locationId;
          return dimensionsChanged ? allRolls : op.removeStockItemIds;
        });
        const locked = new Map(
          (
            await this.stockCorrections.lockForCorrection(
              context,
              affectedStockIds,
            )
          ).map((stock) => [stock.id, stock]),
        );
        const effects: StockEffect[] = [];
        let position = Math.max(0, ...lines.map((l) => l.position));
        let changed =
          input.purchaseOrderNumber !== undefined &&
          input.purchaseOrderNumber !== header.purchaseOrderNumber;
        for (const op of input.operations) {
          if (op.action === 'add') {
            const [line] = await context.stockReceipts.createItems([
              {
                stockReceiptId: id,
                position: ++position,
                ...op.data,
                widthMm: op.data.widthMm.toFixed(3),
                initialLengthMm: op.data.initialLengthMm.toFixed(3),
              },
            ]);
            effects.push(
              ...(await this.stockItems.receiveRolls(
                [{ ...op.data, stockReceiptItemId: line!.id }],
                context,
              )),
            );
            changed = true;
            continue;
          }
          const line = lines.find((l) => l.id === op.lineId);
          if (!line || line.voidedAt)
            throw new BadRequestException(
              'Select an active line from this receipt.',
            );
          const stocks = (
            await this.stockItems.findByStockReceiptItemIds([line.id], context)
          ).filter((r) => !r.voidedAt);
          const data = op.action === 'update' ? op.data : null;
          const dimensionsChanged =
            !!data &&
            (data.fabricColorId !== line.fabricColorId ||
              data.widthMm !== Number(line.widthMm) ||
              data.initialLengthMm !== Number(line.initialLengthMm) ||
              data.locationId !== line.locationId);
          const removeIds =
            op.action === 'remove'
              ? stocks.map((r) => r.id)
              : op.removeStockItemIds;
          if (
            new Set(removeIds).size !== removeIds.length ||
            removeIds.some((stockId) => !stocks.some((r) => r.id === stockId))
          )
            throw new BadRequestException(
              'Select distinct rolls from this receipt line.',
            );
          if (
            data &&
            removeIds.length !== Math.max(0, stocks.length - data.quantity)
          )
            throw new BadRequestException(
              'Select exactly the rolls removed by the corrected quantity.',
            );
          const affectedIds = dimensionsChanged
            ? stocks.map((r) => r.id)
            : removeIds;
          await this.stockCorrections.requireCorrectionEligible(
            context,
            header.stockEffects ?? [],
            input.stockVersions,
            affectedIds,
          );
          effects.push(
            ...(await this.stockCorrections.reviseReceivedRolls(
              context,
              stocks
                .filter((stock) => affectedIds.includes(stock.id))
                .map((stock) => ({
                  before: locked.get(stock.id)!,
                  line: removeIds.includes(stock.id) ? null : data!,
                })),
            )),
          );
          if (data) {
            if (data.quantity > stocks.length)
              effects.push(
                ...(await this.stockItems.receiveRolls(
                  [
                    {
                      ...data,
                      quantity: data.quantity - stocks.length,
                      stockReceiptItemId: line.id,
                    },
                  ],
                  context,
                )),
              );
            await context.stockReceipts.updateItem(line.id, {
              ...data,
              widthMm: data.widthMm.toFixed(3),
              initialLengthMm: data.initialLengthMm.toFixed(3),
            });
            changed ||= dimensionsChanged || data.quantity !== stocks.length;
          } else {
            await context.stockReceipts.updateItem(line.id, {
              voidedAt: new Date(),
            });
            changed = true;
          }
        }
        if (!changed)
          throw new BadRequestException('Provide an actual change.');
        const currentLines = (await context.stockReceipts.findItems(id)).filter(
          (l) => !l.voidedAt,
        );
        if (
          currentLines.length > 100 ||
          currentLines.reduce((n, l) => n + (l.quantity ?? 0), 0) > 1000
        )
          throw new BadRequestException(
            'A receipt supports at most 100 active lines and 1,000 rolls.',
          );
        const baseline = new Map(
          (header.stockEffects ?? []).map((e) => [e.stockItemId, e]),
        );
        for (const e of effects)
          baseline.set(e.stockItemId, {
            ...e,
            before: baseline.has(e.stockItemId)
              ? baseline.get(e.stockItemId)!.before
              : e.before,
          });
        const saved = await context.stockReceipts.update(id, {
          purchaseOrderNumber:
            input.purchaseOrderNumber ?? header.purchaseOrderNumber,
          stockEffects:
            header.stockEffects === null && !effects.length
              ? null
              : [...baseline.values()],
        });
        const result = await this.receipt(context, saved);
        const eventId = await audit.record(
          context,
          userId,
          'receipt.corrected',
          [
            {
              recordType: 'stock-receipts',
              recordId: id,
              before: { type: 'stock-receipts', value: before },
              after: { type: 'stock-receipts', value: result },
            },
            ...stockChanges(effects),
          ],
          input.reason,
        );
        return audit.remember(
          context,
          userId,
          'receipt.correct',
          id,
          key,
          replay.requestHash,
          {
            eventId,
            recordId: id,
            revision: saved.revision,
            affectedAllocationIds: [],
            createdStockItemIds: effects
              .filter((e) => !e.before)
              .map((e) => e.stockItemId),
          },
        );
      }),
    );
  }
  list(query: StockReceiptQuery) {
    return this.operation(() =>
      this.unitOfWork.readOnlyTransaction(async (context) => {
        const result = await context.stockReceipts.list(query);
        return {
          ...result,
          items: result.items.map((item) => this.toPublic(item)),
        };
      }),
    );
  }
  findById(id: string) {
    return this.operation(() =>
      this.unitOfWork.readOnlyTransaction(async (context) => {
        const header = await context.stockReceipts.findById(id);
        if (!header) throw new NotFoundException('Stock receipt not found.');
        return this.detail(context, header);
      }),
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
  private async detail(context: UnitOfWorkContext, header: StockReceiptRecord) {
    if (!header.isDraft) return this.receipt(context, header);
    return stockReceiptDraftSchema.parse({
      ...this.toPublic(header),
      data: this.formData(
        header,
        await context.stockReceipts.findItems(header.id),
      ),
    });
  }
  private async receipt(
    context: UnitOfWorkContext,
    header: StockReceiptRecord,
  ) {
    const lines = await context.stockReceipts.findItems(header.id);
    const stock = await this.stockItems.findByStockReceiptItemIds(
      lines.map((line) => line.id),
      context,
    );
    const result = {
      ...this.toPublic(header),
      items: lines.map((line) => {
        const rolls = stock.filter(
          (item) => item.stockReceiptItemId === line.id,
        );
        return {
          ...line,
          voidedAt: line.voidedAt?.toISOString() ?? null,
          widthMm: Number(line.widthMm),
          initialLengthMm: Number(line.initialLengthMm),
          stockItemIds: rolls.map((item) => item.id),
          stockItems: rolls,
        };
      }),
    };
    return stockReceiptDetailSchema.parse(result);
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
      return await stockReceiptsQuery(operation);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof StockReceiptConflictError)
        throw new ConflictException(error.message, { cause: error });
      if (error instanceof StockReceiptReferenceNotFoundError)
        throw new NotFoundException(error.message, { cause: error });
      if (error instanceof InvalidStockReceiptError)
        throw new BadRequestException(error.message, { cause: error });
      throw new ServiceUnavailableException(
        'Stock-receipt storage is unavailable.',
        { cause: error },
      );
    }
  }
}
