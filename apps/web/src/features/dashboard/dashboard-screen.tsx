'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarClock,
  CalendarDays,
  ClipboardList,
  Layers3,
  PackagePlus,
  Scissors,
  FilePenLine,
  Plus,
  ArrowRight,
} from 'lucide-react';
import { stockList } from '@/features/stock-items';
import { receiptList } from '@/features/stock-receipts';
import { allocationList } from '@/features/allocations';
import { orderTotals, orderList, orderRange } from '@/features/work-orders';
import { Button } from '@/components/ui/button';
import {
  PageHeading,
  ErrorNotice,
  Empty,
  Loading,
  Status,
  TextLink,
} from '@/components/ui/feedback';
import { addDays, mondayOf, nextWeekday, today } from '@/lib/calendar-dates';
import { calendarDateLabel, count, dateLabel } from '@/lib/format';
// The week's orders listed here before the schedule takes over.
const WEEK_ROWS = 8;
export function DashboardScreen() {
  const stock = useQuery(stockList({ pageSize: 1 }));
  const active = useQuery(allocationList({ state: 'active', pageSize: 5 }));
  const receiptDrafts = useQuery(receiptList({ state: 'draft', pageSize: 1 }));
  const allocationDrafts = useQuery(
    allocationList({ state: 'draft', pageSize: 1 }),
  );
  const receipts = useQuery(receiptList({ pageSize: 4 }));
  // The two order queues: fabric to allocate, then a ship date to set.
  const toAllocate = useQuery(orderList({ status: 'new', pageSize: 1 }));
  const toSchedule = useQuery(
    orderList({ status: 'unscheduled', pageSize: 1 }),
  );
  // As on the schedule, a weekend looks at the working week ahead.
  const monday = mondayOf(nextWeekday(today()));
  const week = useQuery(orderRange(monday, addDays(monday, 4)));
  const shipping = [...(week.data ?? [])].sort(
    (a, b) =>
      a.shipDate!.localeCompare(b.shipDate!) ||
      a.orderNumber.localeCompare(b.orderNumber),
  );
  const stats = [
    {
      label: 'Orders to allocate',
      value: toAllocate.data?.total,
      Icon: ClipboardList,
      error: toAllocate.error,
      href: '/work-orders?view=list&status=new',
    },
    {
      label: 'Orders to schedule',
      value: toSchedule.data?.total,
      Icon: CalendarClock,
      error: toSchedule.error,
      href: '/work-orders?view=list&status=unscheduled',
    },
    {
      label: 'Active allocations',
      value: active.data?.total,
      Icon: Scissors,
      error: active.error,
      href: '/allocations?state=active',
    },
    {
      label: 'Stock items on hand',
      value: stock.data?.total,
      Icon: Layers3,
      error: stock.error,
      href: '/stock-items',
    },
    {
      label: 'Receipt drafts',
      value: receiptDrafts.data?.total,
      Icon: PackagePlus,
      error: receiptDrafts.error,
      href: '/stock-receipts?state=draft',
    },
    {
      label: 'Allocation drafts',
      value: allocationDrafts.data?.total,
      Icon: FilePenLine,
      error: allocationDrafts.error,
      href: '/allocations?state=draft',
    },
  ];
  return (
    <>
      <PageHeading title="Overview">
        <Button asChild variant="outline">
          <Link href="/allocations/new">
            <Scissors size={17} />
            New order
          </Link>
        </Button>
        <Button asChild>
          <Link href="/stock-receipts/new">
            <Plus size={17} />
            Receive fabric
          </Link>
        </Button>
      </PageHeading>
      <div className="stats-grid">
        {stats.map(({ label, value, Icon, error, href }) => (
          <Link href={href} className="panel stat" key={label}>
            <div className="stat-label">
              <span>{label}</span>
              <span className="stat-icon">
                <Icon size={17} />
              </span>
            </div>
            <div className="stat-value">
              {error ? '—' : value === undefined ? '…' : count(value)}
            </div>
            {error && (
              <div className="stat-note">Unable to load · open to retry</div>
            )}
          </Link>
        ))}
      </div>
      <div className="section-grid">
        <section className="panel section-wide">
          <div className="panel-heading">
            <div>
              <h2>Shipping this week</h2>
              {week.data && <p>{orderTotals(week.data)}</p>}
            </div>
            <TextLink href="/work-orders">Open schedule</TextLink>
          </div>
          {week.isPending ? (
            <Loading label="Loading work orders…" />
          ) : week.error ? (
            <ErrorNotice error={week.error} retry={() => void week.refetch()} />
          ) : !shipping.length ? (
            <Empty title="No orders ship this week">
              An allocated order is given its ship date on the schedule.
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
                  </tr>
                </thead>
                <tbody>
                  {shipping.slice(0, WEEK_ROWS).map((item) => (
                    <tr key={item.id}>
                      <td>
                        <Link
                          className="cell-leading"
                          href={`/work-orders/${item.id}`}
                        >
                          <span className="cell-icon">
                            <CalendarDays size={16} />
                          </span>
                          <strong>{item.orderNumber}</strong>
                        </Link>
                      </td>
                      <td>{calendarDateLabel(item.shipDate!)}</td>
                      <td>{item.quantity}</td>
                      <td>
                        <Status value={item.status} />
                      </td>
                      <td>{item.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {shipping.length > WEEK_ROWS && (
            <p className="order-count" style={{ padding: '12px 22px' }}>
              <TextLink href="/work-orders">
                All {shipping.length} orders this week
              </TextLink>
            </p>
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>Active allocations</h2>
            <TextLink href="/allocations?state=active">View all</TextLink>
          </div>
          {active.isPending ? (
            <Loading label="Loading allocations…" />
          ) : active.error ? (
            <ErrorNotice
              error={active.error}
              retry={() => void active.refetch()}
            />
          ) : !active.data.items.length ? (
            <Empty title="No active allocations">
              Confirmed allocations will appear here.
            </Empty>
          ) : (
            <div className="data-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Created</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {active.data.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <Link
                          className="cell-leading"
                          href={`/allocations/${item.id}`}
                        >
                          <span className="cell-icon">
                            <Scissors size={16} />
                          </span>
                          <strong>{item.orderNumber}</strong>
                        </Link>
                      </td>
                      <td>{dateLabel(item.createdAt)}</td>
                      <td>
                        <Status
                          value={
                            item.needsReplanning
                              ? 'needs-replanning'
                              : item.state
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>Recent receipts</h2>
            <TextLink href="/stock-receipts">All receipts</TextLink>
          </div>
          {receipts.isPending ? (
            <Loading label="Loading receipts…" />
          ) : receipts.error ? (
            <ErrorNotice error={receipts.error} />
          ) : !receipts.data.items.length ? (
            <Empty title="No stock receipts">
              Submitted receipts will appear here.
            </Empty>
          ) : (
            <div>
              {receipts.data.items.map((item) => (
                <Link
                  href={`/stock-receipts/${item.id}`}
                  key={item.id}
                  className="arrival-row"
                >
                  <span className="cell-icon">
                    <PackagePlus size={17} />
                  </span>
                  <span>
                    <strong>{item.purchaseOrderNumber}</strong>
                    <small>
                      {item.submittedAt ? dateLabel(item.submittedAt) : 'Draft'}
                    </small>
                  </span>
                  <ArrowRight size={16} />
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
