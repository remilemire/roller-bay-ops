import { z } from 'zod';
import { employeeListSchema } from '@roller-bay/shared/employees';
import {
  productionCompletionsSchema,
  stationOrderListSchema,
  worksheetSchema,
  worksheetListSchema,
  type StationQuery,
} from '@roller-bay/shared/production';
import type { Station } from '@roller-bay/shared/users';
import { locationListSchema } from '@roller-bay/shared/locations';
import { api, queryString } from '@/lib/api';
export const productionKey = ['production'] as const;
export const stationLabels: Record<Station, string> = {
  cutting: 'Cutting',
  assembly: 'Assembly',
  checking: 'Checking',
  shipping: 'Shipping',
};
export const completionLabels: Record<Station, string> = {
  cutting: 'cut',
  assembly: 'assembled',
  checking: 'checked',
  shipping: 'shipped',
};
export const productionEmployees = () => ({
  queryKey: [...productionKey, 'employees'],
  queryFn: () => api('/production/employees', employeeListSchema),
});
export const productionOrders = (station: Station, query: StationQuery) => ({
  queryKey: [...productionKey, station, 'orders', query],
  queryFn: () =>
    api(
      `/production/${station}/orders${queryString(query)}`,
      stationOrderListSchema,
    ),
  refetchInterval: 10000,
});
export const completions = (id: string) => ({
  queryKey: [...productionKey, 'completions', id],
  queryFn: () =>
    api(`/production/orders/${id}/completions`, productionCompletionsSchema),
  refetchInterval: 10000,
});
export const mutationResultSchema = z.object({
  recordId: z.uuid(),
  revision: z.number(),
});
export const worksheetForOrder = (id: string) => ({
  queryKey: [...productionKey, 'worksheet-order', id],
  // 204 means the order has no live sheet; queries cannot hold undefined.
  queryFn: () =>
    api(
      `/production/cutting/orders/${id}/worksheet`,
      worksheetSchema.optional(),
    ).then((sheet) => sheet ?? null),
  refetchInterval: 10000,
});
export const worksheetDetail = (id: string) => ({
  queryKey: [...productionKey, 'worksheet', id],
  queryFn: () => api(`/production/cutting/worksheets/${id}`, worksheetSchema),
});
export const worksheets = () => ({
  queryKey: [...productionKey, 'review'],
  queryFn: () => api('/production/cutting/worksheets', worksheetListSchema),
  refetchInterval: 10000,
});
export async function lookupCuttingLocations(
  search: string,
  page: number,
  signal: AbortSignal,
) {
  const data = await api(
    `/production/cutting/locations${queryString({ search, page, pageSize: 25 })}`,
    locationListSchema,
    { signal },
  );
  return {
    total: data.total,
    items: data.items.map((i) => ({
      id: i.id,
      label: `${i.zoneName} / ${i.sectionLabel} / ${i.label}`,
    })),
  };
}
