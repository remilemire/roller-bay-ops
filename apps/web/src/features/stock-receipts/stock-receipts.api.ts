import { queryOptions } from '@tanstack/react-query';
import {
  stockReceiptListSchema,
  stockReceiptRecordSchema,
  stockReceiptDraftSchema,
  stockReceiptSchema,
  stockReceiptDraftDataSchema,
  type StockReceiptDraftData,
} from '@roller-bay/shared/stock-receipts';
import { api, noContent, queryString } from '@/lib/api';
export const receiptKey = ['stock-receipts'] as const;
export const receiptList = (filters: Record<string, unknown> = {}) =>
  queryOptions({
    queryKey: [...receiptKey, 'list', filters],
    queryFn: ({ signal }) =>
      api(
        `/stock-receipts${queryString({ pageSize: 25, ...filters })}`,
        stockReceiptListSchema,
        { signal },
      ),
  });
export const receiptDetail = (id: string) =>
  queryOptions({
    queryKey: [...receiptKey, id],
    queryFn: ({ signal }) =>
      api(`/stock-receipts/${id}`, stockReceiptRecordSchema, { signal }),
  });
export const createReceiptDraft = (data: StockReceiptDraftData, key: string) =>
  api('/stock-receipts/drafts', stockReceiptDraftSchema, {
    method: 'POST',
    body: { data: stockReceiptDraftDataSchema.parse(data) },
    key,
  });
export const saveReceiptDraft = (
  id: string,
  expectedRevision: number,
  data: StockReceiptDraftData,
) =>
  api(`/stock-receipts/${id}/draft`, stockReceiptDraftSchema, {
    method: 'PUT',
    body: { expectedRevision, data: stockReceiptDraftDataSchema.parse(data) },
  });
export const submitReceipt = (id: string, expectedRevision: number) =>
  api(`/stock-receipts/${id}/submit`, stockReceiptSchema, {
    method: 'POST',
    body: { expectedRevision },
  });
export const deleteReceiptDraft = (id: string, expectedRevision: number) =>
  api(`/stock-receipts/${id}/draft`, noContent, {
    method: 'DELETE',
    body: { expectedRevision },
  });
