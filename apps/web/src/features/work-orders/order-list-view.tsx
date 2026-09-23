'use client';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CalendarDays } from 'lucide-react';
import { useState } from 'react';
import type { WorkOrder } from '@roller-bay/shared/work-orders';
import { Button } from '@/components/ui/button';
import {
  Empty,
  ErrorNotice,
  Loading,
  Pagination,
  Status,
} from '@/components/ui/feedback';
import { SearchToolbar } from '@/components/ui/search-toolbar';
import { calendarDateLabel } from '@/lib/format';
import { useListParams } from '@/lib/use-list-params';
import { OrderReschedule } from './order-reschedule';
import { orderList } from './work-orders.api';

// The schedule opens on orders that still need work; `all` includes shipped.
const tabs = [
  { value: 'open', label: 'Open' },
  // The two work queues: fabric to allocate, then a date to set.
  { value: 'new', label: 'To allocate' },
  { value: 'unscheduled', label: 'To schedule' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'cut', label: 'Cut' },
  { value: 'assembled', label: 'Assembled' },
  { value: 'checked', label: 'Checked' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'all', label: 'All orders' },
];
export function OrderListView({ canManage }: { canManage: boolean }) {
  const params = useListParams();
  const [rescheduling, setRescheduling] = useState<WorkOrder | null>(null);
  const status = tabs.some((tab) => tab.value === params.get('status'))
    ? params.get('status')
    : 'open';
  const query = useQuery({
    ...orderList({
      search: params.search,
      page: params.page,
      status: status === 'all' ? '' : status,
    }),
    // Keep the rows on screen while a search typed or a page turned loads.
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <SearchToolbar
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
      <section className="panel">
        {query.isPending ? (
          <Loading />
        ) : query.error ? (
          <ErrorNotice error={query.error} retry={() => void query.refetch()} />
        ) : !query.data.items.length ? (
          <Empty title="No orders here">
            Use New order to enter an order and allocate its fabric.
          </Empty>
        ) : (
          <div className="data-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Ship date</th>
                  <th>Blinds</th>
                  <th>Status</th>
                  <th>Note</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <Link
                        className="cell-leading"
                        href={`/work-orders/${order.id}`}
                      >
                        <span className="cell-icon">
                          <CalendarDays size={17} />
                        </span>
                        <strong>{order.orderNumber}</strong>
                      </Link>
                    </td>
                    <td>
                      {order.shipDate ? calendarDateLabel(order.shipDate) : '—'}
                    </td>
                    <td>{order.quantity}</td>
                    <td>
                      <Status value={order.status} />
                    </td>
                    <td>{order.note}</td>
                    <td>
                      <div className="inline-actions">
                        {/* Planning fabric is open to everyone; the rest of
                            an order's changes are an admin's. */}
                        {order.status === 'new' && (
                          <Button asChild variant="ghost" size="sm">
                            <Link
                              href={`/allocations/new?workOrder=${order.id}`}
                              aria-label={`Allocate order ${order.orderNumber}`}
                            >
                              Allocate
                            </Link>
                          </Button>
                        )}
                        {canManage && (
                          <>
                            {/* A date follows the allocation. */}
                            {order.allocatedAt && (
                              <Button
                                variant="ghost"
                                size="sm"
                                aria-label={`${order.shipDate ? 'Reschedule' : 'Schedule'} order ${order.orderNumber}`}
                                onClick={() => setRescheduling(order)}
                              >
                                {order.shipDate ? 'Reschedule' : 'Schedule'}
                              </Button>
                            )}
                            {order.allocatedAt && (
                              <Button asChild variant="ghost" size="sm">
                                <Link
                                  href={`/stations?station=shipping&search=${order.orderNumber}`}
                                >
                                  Record production
                                </Link>
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
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
      {rescheduling && (
        <OrderReschedule
          order={rescheduling}
          close={() => setRescheduling(null)}
        />
      )}
    </>
  );
}
