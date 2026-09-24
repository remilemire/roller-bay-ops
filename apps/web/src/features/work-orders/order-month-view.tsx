'use client';
import { AllocationWarning } from './allocation-warning';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ErrorNotice, Loading } from '@/components/ui/feedback';
import {
  addMonths,
  isMonth,
  monthOf,
  monthWeeks,
  nextWeekday,
  today,
} from '@/lib/calendar-dates';
import { calendarDateLabel, monthLabel, weekdayLabel } from '@/lib/format';
import { useListParams } from '@/lib/use-list-params';
import { cn } from '@/lib/utils';
import { OrderCalendarNav } from './order-calendar-nav';
import { orderRange } from './work-orders.api';
import {
  blindCount,
  orderCount,
  orderTotals,
  totalBlinds,
} from './order-totals';

// A day lists this many orders; the rest are a link to its week.
const SHOWN = 4;
export function OrderMonthView() {
  const params = useListParams();
  const thisMonth = monthOf(nextWeekday(today()));
  const month = isMonth(params.get('month')) ? params.get('month') : thisMonth;
  // Orders ship on weekdays, so the grid is Monday to Friday. Edge weeks show
  // the neighbouring months' days, and the query covers them too.
  const weeks = monthWeeks(month, true);
  const query = useQuery(orderRange(weeks[0]![0]!, weeks.at(-1)!.at(-1)!));
  const orders = query.data ?? [];
  return (
    <>
      <OrderCalendarNav
        period="month"
        label={monthLabel(month)}
        summary={
          query.data
            ? orderTotals(
                // The range is by ship date, so every order here has one.
                orders.filter((order) => monthOf(order.shipDate!) === month),
              )
            : 'Loading…'
        }
        onStep={(direction) =>
          params.set({ month: addMonths(month, direction) })
        }
        onToday={() => params.set({ month: '' })}
      />
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorNotice error={query.error} retry={() => void query.refetch()} />
      ) : (
        <div
          className="month-grid panel"
          role="grid"
          aria-label={monthLabel(month)}
        >
          <div role="row">
            {weeks[0]!.map((day) => (
              <span key={day} role="columnheader">
                {weekdayLabel(day)}
              </span>
            ))}
          </div>
          {weeks.map((week) => (
            <div key={week[0]} role="row">
              {week.map((day) => {
                const dayOrders = orders
                  .filter((order) => order.shipDate === day)
                  .sort((a, b) => a.orderNumber.localeCompare(b.orderNumber));
                return (
                  <div
                    key={day}
                    role="gridcell"
                    aria-label={calendarDateLabel(day)}
                    aria-current={day === today() ? 'date' : undefined}
                    className={cn(
                      'month-day',
                      monthOf(day) !== month && 'is-outside',
                    )}
                  >
                    <header>
                      <span className="month-day-number">
                        {Number(day.slice(8))}
                      </span>
                      {dayOrders.length > 0 && (
                        <small>
                          {orderCount(dayOrders.length)} ·{' '}
                          {blindCount(totalBlinds(dayOrders))}
                        </small>
                      )}
                    </header>
                    <ul>
                      {dayOrders.slice(0, SHOWN).map((order) => (
                        <li key={order.id}>
                          <Link
                            href={`/work-orders/${order.id}`}
                            className={`month-order status-${order.status}`}
                            title={[blindCount(order.quantity), order.note]
                              .filter(Boolean)
                              .join(' · ')}
                          >
                            {order.orderNumber}
                            <AllocationWarning order={order} />
                            <span className="sr-only">, {order.status}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                    {dayOrders.length > SHOWN && (
                      <Link
                        className="text-link"
                        href={`/work-orders?view=week&week=${day}`}
                      >
                        +{dayOrders.length - SHOWN} more
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
