import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  receiptCorrectionContextSchema,
  type ReceiptCorrection,
} from '@roller-bay/shared/corrections';
import type { StockEffect } from '@roller-bay/shared/stock-items';
import { UnitOfWork } from '../../unit-of-work/unit-of-work.js';
import { AuditService } from '../audit/audit.service.js';
import { StockCorrectionsService } from '../stock-items/stock-corrections.service.js';
import { stockChanges } from '../stock-items/stock-items.audit.js';
import { StockItemsService } from '../stock-items/stock-items.service.js';
import { StockReceiptDetailsService } from './stock-receipt-details.service.js';
import { stockReceiptsOperation } from './stock-receipts.operation.js';
/**
 * Corrects a submitted receipt's paperwork and lines, voiding, revising or
 * adding the rolls they received.
 */
@Injectable()
export class ReceiptCorrectionsService {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly audit: AuditService,
    private readonly stockItems: StockItemsService,
    private readonly stockCorrections: StockCorrectionsService,
    private readonly details: StockReceiptDetailsService,
  ) {}
  context(id: string) {
    return stockReceiptsOperation(() =>
      this.unitOfWork.readOnlyTransaction(async (context) => {
        const header = await context.stockReceipts.findById(id);
        if (!header) throw new NotFoundException('Stock receipt not found.');
        if (header.isDraft)
          throw new ConflictException(
            'Submit the receipt before correcting it.',
          );
        const record = await this.details.submitted(context, header);
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
    return stockReceiptsOperation(() =>
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
        const before = await this.details.submitted(context, header);
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
        const result = await this.details.submitted(context, saved);
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
}
