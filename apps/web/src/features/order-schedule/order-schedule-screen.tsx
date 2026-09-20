'use client';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Plus } from 'lucide-react';
import { useState } from 'react';
import type { ScheduledOrder } from '@roller-bay/shared/order-schedule';
import { useCanManage } from '@/features/auth/auth-boundary';
import { Button } from '@/components/ui/button';
import {
  Empty,
  ErrorNotice,
  Loading,
  PageHeading,
  Pagination,
  Status,
} from '@/components/ui/feedback';
import { SearchToolbar } from '@/components/ui/search-toolbar';
import { calendarDateLabel } from '@/lib/format';
import { useListParams } from '@/lib/use-list-params';
import { OrderEditor } from './order-editor';
import { orderList, orderScheduleKey, updateOrder } from './order-schedule.api';

// The schedule opens on orders that still need work; `all` includes shipped.
const tabs = [
  { value: 'open', label: 'Open' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'allocated', label: 'Allocated' },
  { value: 'cut', label: 'Cut' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'all', label: 'All orders' },
];
export function OrderScheduleScreen() {
  const params = useListParams();
  const canManage = useCanManage();
  const [adding, setAdding] = useState(false);
  const status = tabs.some((tab) => tab.value === params.get('status'))
    ? params.get('status')
    : 'open';
  const query = useQuery(
    orderList({
      search: params.search,
      page: params.page,
      status: status === 'all' ? '' : status,
    }),
  );
  const client = useQueryClient();
  const ship = useMutation({
    mutationFn: (order: ScheduledOrder) =>
      updateOrder(order.id, {
        expectedRevision: order.revision,
        shipped: !order.shippedAt,
      }),
    // A refused request usually means the row is stale, so refresh either way.
    onSettled: () => client.invalidateQueries({ queryKey: orderScheduleKey }),
  });
  return (
    <>
      <PageHeading title="Order schedule">
        {canManage && (
          <Button onClick={() => setAdding(true)}>
            <Plus size={17} />
            Add order
          </Button>
        )}
      </PageHeading>
      <SearchToolbar
        key={params.search}
        search={params.search}
        // The API caps the search at an order number's six characters.
        onSearch={(search) => params.set({ search: search.trim().slice(0, 6) })}
        placeholder="Search order number…"
      >
        <div className="tabs">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              className={`tab ${status === tab.value ? 'active' : ''}`}
              onClick={() =>
                params.set({ status: tab.value === 'open' ? '' : tab.value })
              }
            >
              {tab.label}
            </button>
          ))}
        </div>
      </SearchToolbar>
      {ship.error && <ErrorNotice error={ship.error} />}
      <section className="panel">
        {query.isPending ? (
          <Loading />
        ) : query.error ? (
          <ErrorNotice error={query.error} retry={() => void query.refetch()} />
        ) : !query.data.items.length ? (
          <Empty title="No orders here">
            {canManage
              ? 'Add an order so fabric can be allocated to it.'
              : 'An admin adds orders before fabric can be allocated.'}
          </Empty>
        ) : (
          <div className="data-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Ship date</th>
                  <th>Status</th>
                  <th>Note</th>
                  {canManage && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <Link
                        className="cell-leading"
                        href={`/order-schedule/${order.id}`}
                      >
                        <span className="cell-icon">
                          <CalendarDays size={17} />
                        </span>
                        <strong>{order.orderNumber}</strong>
                      </Link>
                    </td>
                    <td>{calendarDateLabel(order.shipDate)}</td>
                    <td>
                      <Status value={order.status} />
                    </td>
                    <td>{order.note}</td>
                    {canManage && (
                      <td>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={ship.isPending}
                          // Every row has this button; name the order it acts on.
                          aria-label={`Mark order ${order.orderNumber} ${order.shippedAt ? 'not shipped' : 'shipped'}`}
                          onClick={() => ship.mutate(order)}
                        >
                          {ship.isPending && ship.variables.id === order.id
                            ? 'Saving…'
                            : order.shippedAt
                              ? 'Mark not shipped'
                              : 'Mark shipped'}
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {query.data && (
          <Pagination
            page={params.page}
            total={query.data.total}
            onPage={(page) => params.set({ page })}
          />
        )}
      </section>
      {adding && <OrderEditor close={() => setAdding(false)} />}
    </>
  );
}
