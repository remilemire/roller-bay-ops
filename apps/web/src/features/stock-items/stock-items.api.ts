import { queryOptions } from '@tanstack/react-query';
import {
  stockItemListSchema,
  stockItemSchema,
  createStockItemSchema,
  updateStockItemSchema,
} from '@roller-bay/shared/stock-items';
import { api, noContent, queryString } from '@/lib/api';
export const stockKey = ['stock-items'] as const;
export const stockList = (filters: Record<string, unknown> = {}) =>
  queryOptions({
    queryKey: [...stockKey, 'list', filters],
    queryFn: ({ signal }) =>
      api(
        `/stock-items${queryString({ pageSize: 25, ...filters })}`,
        stockItemListSchema,
        { signal },
      ),
  });
export const stockDetail = (id: string) =>
  queryOptions({
    queryKey: [...stockKey, id],
    queryFn: ({ signal }) =>
      api(`/stock-items/${id}`, stockItemSchema, { signal }),
  });
export const saveStock = (body: unknown, id?: string) =>
  api(`/stock-items${id ? `/${id}` : ''}`, stockItemSchema, {
    method: id ? 'PATCH' : 'POST',
    body: id
      ? updateStockItemSchema.parse(body)
      : createStockItemSchema.parse(body),
  });
export const deleteStock = (id: string) =>
  api(`/stock-items/${id}`, noContent, { method: 'DELETE' });
export async function lookupStock(
  search: string,
  page: number,
  signal: AbortSignal,
) {
  const data = await api(
    `/stock-items${queryString({ search, page, pageSize: 25, isConsumed: false })}`,
    stockItemListSchema,
    { signal },
  );
  return {
    total: data.total,
    items: data.items.map((i) => ({
      id: i.id,
      label: `${i.fabricColorCode} · ${Number((i.widthMm / 25.4).toFixed(2))} in · ${i.id.slice(0, 8).toUpperCase()}`,
    })),
  };
}
