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
import { useRememberedParam } from '@/lib/use-remembered-param';
import { calendarDateLabel, count, dateTimeLabel } from '@/lib/format';
import { SearchToolbar } from '@/components/ui/search-toolbar';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Button } from '@/components/ui/button';
import {
  PageHeading,
  Loading,
  ErrorNotice,
  Pagination,
} from '@/components/ui/feedback';
import {
  productionOrders,
  stationLabels,
  completionLabels,
  employeeNames,
} from './production.api';
import { CompletionAction } from './completion-action';
import { RequestRecut, RecutActions } from './recut-actions';
import { StationOrderGrid } from './station-order-grid';
export function StationsScreen() {
  const user = useCurrentUser();
  const canManage = useCanManage();
  const allowed =
    user.role === 'production' ? user.stations : stationSchema.options;
  // Completions are credited to the open station, so accounts with a choice
  // pick one explicitly, and this browser reopens the last one picked; an
  // unassigned or unknown station asks again. An account with one station
  // has nothing to pick or remember.
  const remembered = useRememberedParam(
    'station',
    'roller-bay-station',
    allowed.length > 1 ? allowed : [],
  );
  const station = allowed.length === 1 ? allowed[0] : remembered.value;
  const officeActions = (user.role === 'staff' || canManage) && (
    <>
      {canManage && (
        <Button asChild variant="outline">
          <Link href="/stations/employees">Manage employees</Link>
        </Button>
      )}
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
  if (station === null) return null;
  if (!station)
    return (
      <div className="station-workspace">
        <PageHeading title="Stations">{officeActions}</PageHeading>
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
            <Link href="/stations" onClick={remembered.forget}>
              Change station
            </Link>
          </Button>
        )}
        {officeActions}
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
      className="panel station-choice summary-glass"
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
  const canAssign =
    useCurrentUser().role !== 'production' && station === 'cutting';
  const view =
    canAssign && params.get('view') === 'recuts'
      ? 'recuts'
      : params.get('view') === 'completed'
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
    <div className="stack station-queue">
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
            ...(canAssign
              ? [{ value: 'recuts' as const, label: 'Awaiting fabric' }]
              : []),
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
          <StationOrderGrid>
            {!query.data.items.length && <p>No matching orders.</p>}
            {query.data.items.map((order) => (
              <section
                className="panel station-order"
                key={order.id}
                aria-label={`Order ${order.orderNumber}`}
              >
                <div className="station-order-header">
                  <div className="station-order-summary">
                    <div className="station-order-identity">
                      <h2>{order.orderNumber}</h2>
                      <span className="station-order-state">
                        {stationLabels[station]}{' '}
                        {order[stamp[station]] ? 'recorded' : 'not recorded'}
                      </span>
                    </div>
                    <p className="station-order-meta">
                      {count(order.quantity)}{' '}
                      {order.quantity === 1 ? 'blind' : 'blinds'} ·{' '}
                      {order.shipDate
                        ? `Ships ${calendarDateLabel(order.shipDate)}`
                        : 'Unscheduled'}
                    </p>
                  </div>
                  {view === 'recuts' ? null : station === 'cutting' ? (
                    (order.cutAt || order.cutAwaitingRecuts) &&
                    order.worksheetNeedsCorrection ? (
                      <Button asChild>
                        <Link href={`/stations/cutting/${order.id}`}>
                          Correct returned worksheet
                        </Link>
                      </Button>
                    ) : (
                      !order.cutAt &&
                      !order.shippedAt && (
                        <CuttingChoice
                          orderId={order.id}
                          orderNumber={order.orderNumber}
                          awaitingCut={order.recuts.some(
                            (r) =>
                              r.stage === 'requested' || r.stage === 'cutting',
                          )}
                          originalSubmitted={order.cutAwaitingRecuts}
                          hasWorksheet={order.hasCuttingWorksheet}
                        />
                      )
                    )
                  ) : order.shippedAt && view === 'queue' ? null : (station ===
                      'checking' ||
                      station === 'shipping') &&
                    !order[stamp[station]] &&
                    order.recuts.some(
                      (r) => r.stage !== 'accepted' && r.stage !== 'withdrawn',
                    ) ? (
                    <span>Awaiting recut</span>
                  ) : (
                    <CompletionAction
                      station={station}
                      orderId={order.id}
                      orderNumber={order.orderNumber}
                      done={!!order[stamp[station]]}
                    />
                  )}
                </div>
                {order.recuts
                  .filter((r) =>
                    view === 'recuts'
                      ? r.stage === 'requested'
                      : !['accepted', 'withdrawn'].includes(r.stage) ||
                        r.needsCorrection,
                  )
                  .map((r) => (
                    <RecutActions key={r.id} recut={r} station={station} />
                  ))}
                {order.note && (
                  <p className="station-order-note">
                    <span>Note</span> {order.note}
                  </p>
                )}
                <div className="station-order-footer">
                  <details className="station-order-history">
                    <summary>
                      Production details ·{' '}
                      {order.completions.length
                        ? stationSchema.options
                            .filter((stage) =>
                              order.completions.some(
                                (c) => c.station === stage,
                              ),
                            )
                            .map((stage) => completionLabels[stage])
                            .join(', ')
                        : 'No stages recorded'}
                    </summary>
                    <dl className="station-history">
                      {/* Stages are independent: never infer an earlier completion
                        from a later one or turn this into a progress bar. */}
                      {stationSchema.options.map((stage) => {
                        const completion = order.completions.find(
                          (c) => c.station === stage,
                        );
                        return (
                          <div className="station-history-row" key={stage}>
                            <dt>{stationLabels[stage]}</dt>
                            <dd>
                              {completion ? (
                                <>
                                  <span>
                                    {employeeNames(completion.employees)}
                                  </span>
                                  <time dateTime={completion.completedAt}>
                                    {dateTimeLabel(completion.completedAt)}
                                  </time>
                                </>
                              ) : (
                                <span className="muted">Not recorded</span>
                              )}
                            </dd>
                          </div>
                        );
                      })}
                    </dl>
                  </details>
                  {view !== 'recuts' && (
                    <RequestRecut
                      orderId={order.id}
                      orderNumber={order.orderNumber}
                    />
                  )}
                </div>
              </section>
            ))}
          </StationOrderGrid>
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
  awaitingCut,
  originalSubmitted,
}: {
  orderId: string;
  orderNumber: string;
  hasWorksheet: boolean;
  awaitingCut: boolean;
  originalSubmitted: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (originalSubmitted)
    return awaitingCut ? (
      <span>Awaiting replacement cut</span>
    ) : (
      <CompletionAction
        station="cutting"
        orderId={orderId}
        orderNumber={orderNumber}
        done={false}
      />
    );
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
          {awaitingCut ? (
            <p>Cutting sign-off is waiting for replacement fabric to be cut.</p>
          ) : (
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
          )}
          <section className="stack">
            <h3>Cutting worksheet</h3>
            <p>Follow cutting instructions and save measurements.</p>
            <div className="inline-actions">
              <Button asChild>
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
