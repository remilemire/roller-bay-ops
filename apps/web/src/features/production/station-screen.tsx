'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  ClipboardCheck,
  Scissors,
  Truck,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { stationSchema, type Station } from '@roller-bay/shared/users';
import { useCurrentUser, useCanManage } from '@/features/auth';
import { useListParams } from '@/lib/use-list-params';
import { calendarDateLabel, count, dateTimeLabel } from '@/lib/format';
import { SearchToolbar } from '@/components/ui/search-toolbar';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Button } from '@/components/ui/button';
import {
  PageHeading,
  Loading,
  ErrorNotice,
  Pagination,
  Status,
} from '@/components/ui/feedback';
import {
  productionOrders,
  stationLabels,
  completionLabels,
  employeeNames,
} from './production.api';
import { CompletionAction } from './completion-action';
export function StationsScreen() {
  const user = useCurrentUser();
  const canManage = useCanManage();
  const params = useListParams();
  const allowed =
    user.role === 'production' ? user.stations : stationSchema.options;
  const parsed = stationSchema.safeParse(params.get('station'));
  // Completions are credited to the open station, so accounts with a choice
  // pick one explicitly; an unassigned or unknown station asks again.
  const station =
    parsed.success && allowed.includes(parsed.data)
      ? parsed.data
      : allowed.length === 1
        ? allowed[0]
        : undefined;
  const manage = canManage && (
    <>
      <Button asChild variant="outline">
        <Link href="/stations/employees">Manage employees</Link>
      </Button>
      <Button asChild variant="outline">
        <Link href="/stations/review">Review cutting results</Link>
      </Button>
    </>
  );
  if (!allowed.length)
    return (
      <>
        <PageHeading title="Stations" />
        <p>An admin must assign this account to a station in Users.</p>
      </>
    );
  if (!station)
    return (
      <div className="station-workspace">
        <PageHeading title="Stations">{manage}</PageHeading>
        <nav className="station-choices" aria-label="Choose station">
          {stationSchema.options
            .filter((value) => allowed.includes(value))
            .map((value) => (
              <StationChoice key={value} station={value} />
            ))}
        </nav>
      </div>
    );
  return (
    <div className="station-workspace">
      <PageHeading title={`${stationLabels[station]} station`}>
        {allowed.length > 1 && (
          <Button asChild variant="outline">
            <Link href="/stations">Change station</Link>
          </Button>
        )}
        {manage}
      </PageHeading>
      <StationQueue key={station} station={station} />
    </div>
  );
}
const stationIcons: Record<Station, LucideIcon> = {
  cutting: Scissors,
  assembly: Wrench,
  checking: ClipboardCheck,
  shipping: Truck,
};
function StationChoice({ station }: { station: Station }) {
  // The same first page the station opens with, so choosing it is instant.
  const queue = useQuery(
    productionOrders(station, { search: '', page: 1, view: 'queue' }),
  );
  const Icon = stationIcons[station];
  const total = queue.data?.total;
  return (
    <Link
      href={`/stations?station=${station}`}
      className="panel station-choice"
    >
      <span className="stat-icon">
        <Icon size={20} />
      </span>
      <span className="station-choice-text">
        <span className="station-choice-name">{stationLabels[station]}</span>
        <span className="station-choice-note">
          {queue.error
            ? 'Queue unavailable'
            : total === undefined
              ? 'Loading queue…'
              : total === 0
                ? 'Queue clear'
                : `${count(total)} ${total === 1 ? 'order' : 'orders'} in queue`}
        </span>
      </span>
      <ArrowRight size={17} className="station-choice-arrow" />
    </Link>
  );
}
function StationQueue({ station }: { station: Station }) {
  const params = useListParams();
  const view =
    params.get('view') === 'completed'
      ? 'completed'
      : params.get('view') === 'all' || params.search
        ? 'all'
        : 'queue';
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const query = useQuery(
    productionOrders(station, {
      search: params.search,
      page: params.page,
      view,
      ...(view === 'completed'
        ? { from: start.toISOString(), to: end.toISOString() }
        : {}),
    }),
  );
  const stamp = {
    cutting: 'cutAt',
    assembly: 'assembledAt',
    checking: 'checkedAt',
    shipping: 'shippedAt',
  } as const;
  return (
    <div className="stack">
      <SearchToolbar
        search={params.search}
        onSearch={(search) =>
          params.set({ search: search.replace(/\D/g, '').slice(0, 6), page: 1 })
        }
        placeholder="Search order number…"
        inputMode="numeric"
        maxLength={6}
      >
        <SegmentedControl
          label="Order view"
          value={view}
          options={[
            { value: 'queue', label: 'Work queue' },
            { value: 'completed', label: 'Completed today' },
            { value: 'all', label: 'All allocated orders' },
          ]}
          onChange={(value) => params.set({ view: value, search: '', page: 1 })}
        />
      </SearchToolbar>
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorNotice error={query.error} retry={() => void query.refetch()} />
      ) : (
        <>
          {!query.data.items.length && <p>No matching orders.</p>}
          {query.data.items.map((order) => (
            <section className="panel" key={order.id}>
              <div className="panel-heading">
                <h2>{order.orderNumber}</h2>
                <Status value={order.status} />
              </div>
              <div className="panel-body stack">
                <p>
                  {order.quantity} blinds ·{' '}
                  {order.shipDate
                    ? `Ships ${calendarDateLabel(order.shipDate)}`
                    : 'Unscheduled'}
                </p>
                {order.note && <p>{order.note}</p>}
                {order.completions.length > 0 && (
                  <div className="record-list">
                    {order.completions.map((c) => (
                      <p key={c.station}>
                        {completionLabels[c.station]} ·{' '}
                        {employeeNames(c.employees)} ·{' '}
                        {dateTimeLabel(c.completedAt)}
                      </p>
                    ))}
                  </div>
                )}
                {station === 'cutting' ? (
                  !order.cutAt && (
                    <CuttingChoice
                      orderId={order.id}
                      orderNumber={order.orderNumber}
                      hasWorksheet={order.hasCuttingWorksheet}
                    />
                  )
                ) : (
                  <CompletionAction
                    station={station}
                    orderId={order.id}
                    orderNumber={order.orderNumber}
                    done={!!order[stamp[station]]}
                  />
                )}
              </div>
            </section>
          ))}
          <Pagination
            page={params.page}
            total={query.data.total}
            onPage={(page) => params.set({ page })}
          />
        </>
      )}
    </div>
  );
}

function CuttingChoice({
  orderId,
  orderNumber,
  hasWorksheet,
}: {
  orderId: string;
  orderNumber: string;
  hasWorksheet: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="inline-actions">
        <Button onClick={() => setOpen(true)}>Record cutting</Button>
      </div>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={`Record cutting · ${orderNumber}`}
        description="Choose how to record this order's cutting."
      >
        <div className="stack">
          <section className="stack">
            <h3>Sign off only</h3>
            <p>
              Mark the order cut now and credit the selected employees. No
              measurements are submitted.
            </p>
            <CompletionAction
              station="cutting"
              orderId={orderId}
              orderNumber={orderNumber}
              inline
              done={false}
            />
          </section>
          <section className="stack">
            <h3>Cutting worksheet</h3>
            <p>
              Follow cutting instructions and save measurements. Submitting the
              worksheet also marks the order cut.
            </p>
            <div className="inline-actions">
              <Button asChild variant="outline">
                <Link href={`/stations/cutting/${orderId}`}>
                  {hasWorksheet ? 'Continue worksheet' : 'Use worksheet'}
                </Link>
              </Button>
            </div>
          </section>
        </div>
      </Dialog>
    </>
  );
}
