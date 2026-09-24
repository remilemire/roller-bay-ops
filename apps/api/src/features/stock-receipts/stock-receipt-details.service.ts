import { Injectable } from '@nestjs/common';
import {
  stockReceiptDetailSchema,
  stockReceiptDraftSchema,
  stockReceiptDraftSummarySchema,
  stockReceiptSummarySchema,
} from '@roller-bay/shared/stock-receipts';
import type { UnitOfWorkContext } from '../../unit-of-work/unit-of-work-context.js';
import { StockItemsService } from '../stock-items/stock-items.service.js';
import type {
  StockReceiptRecord,
  StockReceiptsRepository,
} from './stock-receipts.repository.js';
export function receiptSummary(row: StockReceiptRecord) {
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
export function receiptFormData(
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
/** The public reading of a receipt that every workflow returns. */
@Injectable()
export class StockReceiptDetailsService {
  constructor(private readonly stockItems: StockItemsService) {}
  async load(context: UnitOfWorkContext, header: StockReceiptRecord) {
    if (!header.isDraft) return this.submitted(context, header);
    return stockReceiptDraftSchema.parse({
      ...receiptSummary(header),
      data: receiptFormData(
        header,
        await context.stockReceipts.findItems(header.id),
      ),
    });
  }
  /** A submitted receipt with the rolls each line received. */
  async submitted(context: UnitOfWorkContext, header: StockReceiptRecord) {
    const lines = await context.stockReceipts.findItems(header.id);
    const stock = await this.stockItems.findByStockReceiptItemIds(
      lines.map((line) => line.id),
      context,
    );
    const result = {
      ...receiptSummary(header),
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
}
