import { queryOptions } from '@tanstack/react-query';
import * as s from '@roller-bay/shared/order-schedule';
import { api, noContent, queryString } from '@/lib/api';
export const orderScheduleKey = ['order-schedule'] as const;
export const orderList = (filters: Record<string, unknown> = {}) =>
  queryOptions({
    queryKey: [...orderScheduleKey, 'list', filters],
    queryFn: ({ signal }) =>
      api(
        `/order-schedule${queryString({ pageSize: 25, ...filters })}`,
        s.scheduledOrderListSchema,
        { signal },
      ),
  });
export const orderDetail = (id: string) =>
  queryOptions({
    queryKey: [...orderScheduleKey, id],
    queryFn: ({ signal }) =>
      api(`/order-schedule/${id}`, s.scheduledOrderSchema, { signal }),
  });
export const createOrder = (body: unknown) =>
  api('/order-schedule', s.scheduledOrderSchema, {
    method: 'POST',
    body: s.createScheduledOrderSchema.parse(body),
  });
export const updateOrder = (id: string, body: unknown) =>
  api(`/order-schedule/${id}`, s.scheduledOrderSchema, {
    method: 'PATCH',
    body: s.updateScheduledOrderSchema.parse(body),
  });
export const deleteOrder = (id: string, expectedRevision: number) =>
  api(`/order-schedule/${id}`, noContent, {
    method: 'DELETE',
    body: { expectedRevision },
  });
