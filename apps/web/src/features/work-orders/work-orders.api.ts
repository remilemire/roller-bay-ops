import { queryOptions } from '@tanstack/react-query';
import * as s from '@roller-bay/shared/work-orders';
import { api, noContent, queryString } from '@/lib/api';
export const workOrdersKey = ['work-orders'] as const;
export const orderList = (filters: Record<string, unknown> = {}) =>
  queryOptions({
    queryKey: [...workOrdersKey, 'list', filters],
    queryFn: ({ signal }) =>
      api(
        `/work-orders${queryString({ pageSize: 25, ...filters })}`,
        s.workOrderListSchema,
        { signal },
      ),
  });
// The week and month views need every order in their range, while the API
// returns at most 100 a page, so this reads pages until it has them all.
export const orderRange = (shipDateFrom: string, shipDateTo: string) =>
  queryOptions({
    queryKey: [...workOrdersKey, 'range', shipDateFrom, shipDateTo],
    queryFn: async ({ signal }) => {
      const orders: s.WorkOrder[] = [];
      for (let page = 1; ; page++) {
        const data = await api(
          `/work-orders${queryString({ shipDateFrom, shipDateTo, page, pageSize: 100 })}`,
          s.workOrderListSchema,
          { signal },
        );
        orders.push(...data.items);
        if (orders.length >= data.total || !data.items.length) return orders;
      }
    },
  });
export const orderDetail = (id: string) =>
  queryOptions({
    queryKey: [...workOrdersKey, id],
    queryFn: ({ signal }) =>
      api(`/work-orders/${id}`, s.workOrderSchema, { signal }),
  });
export const createOrder = (body: unknown) =>
  api('/work-orders', s.workOrderSchema, {
    method: 'POST',
    body: s.createWorkOrderSchema.parse(body),
  });
export const updateOrder = (id: string, body: unknown) =>
  api(`/work-orders/${id}`, s.workOrderSchema, {
    method: 'PATCH',
    body: s.updateWorkOrderSchema.parse(body),
  });
export const deleteOrder = (id: string, expectedRevision: number) =>
  api(`/work-orders/${id}`, noContent, {
    method: 'DELETE',
    body: { expectedRevision },
  });
// The week board's tray: allocated orders still waiting for a ship date,
// narrowed by the board's search. One page is the API's largest; the list's
// "To schedule" tab has the rest.
export const unscheduledOrders = (search = '') =>
  queryOptions({
    queryKey: [...workOrdersKey, 'unscheduled', search],
    queryFn: () =>
      api(
        `/work-orders${queryString({ status: 'unscheduled', search, pageSize: 100 })}`,
        s.workOrderListSchema,
      ),
  });
