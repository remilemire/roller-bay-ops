'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { stationSchema, type Station } from '@roller-bay/shared/users';
import { useCurrentUser, useCanManage } from '@/features/auth/auth-boundary';
import { useListParams } from '@/lib/use-list-params';
import { calendarDateLabel, dateTimeLabel } from '@/lib/format';
import { TextField } from '@/components/ui/field';
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
} from './production.api';
import { EmployeeSelection, useEmployeeSelection } from './employee-selection';
import { CompletionAction } from './completion-action';
export function StationsScreen() {
  const user = useCurrentUser();
  const canManage = useCanManage();
  const params = useListParams();
  const allowed =
    user.role === 'station' ? user.stations : stationSchema.options;
  const parsed = stationSchema.safeParse(params.get('station'));
  const station =
    parsed.success && allowed.includes(parsed.data) ? parsed.data : allowed[0];
  if (!station)
    return (
      <>
        <PageHeading title="Stations" />
        <p>An admin must assign this account to a station in Users.</p>
      </>
    );
  return (
    <>
      <PageHeading title={`${stationLabels[station]} station`}>
        {canManage && (
          <Button asChild variant="outline">
            <Link href="/stations/review">Review cutting results</Link>
          </Button>
        )}
      </PageHeading>
      <nav className="tabs" aria-label="Stations">
        {allowed.map((s) => (
          <button
            key={s}
            className={`tab ${s === station ? 'active' : ''}`}
            onClick={() =>
              params.set({ station: s, search: '', page: 1, view: 'queue' })
            }
          >
            {stationLabels[s]}
          </button>
        ))}
      </nav>
      <StationQueue key={station} station={station} />
    </>
  );
}
function StationQueue({ station }: { station: Station }) {
  const params = useListParams();
  const employee = useEmployeeSelection();
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
    <div className="stack station-workspace">
      <section className="panel panel-body">
        <EmployeeSelection
          value={employee.employeeId}
          onChange={employee.selectEmployee}
        />
        <TextField
          label="Find order"
          inputMode="numeric"
          maxLength={6}
          value={params.search}
          onChange={(search) =>
            params.set({ search: search.replace(/\D/g, ''), page: 1 })
          }
        />
        <div className="tabs">
          {(['queue', 'completed', 'all'] as const).map((v) => (
            <button
              key={v}
              className={`tab ${view === v ? 'active' : ''}`}
              onClick={() => params.set({ view: v, search: '', page: 1 })}
            >
              {v === 'queue'
                ? 'Work queue'
                : v === 'completed'
                  ? 'Completed today'
                  : 'All allocated orders'}
            </button>
          ))}
        </div>
      </section>
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
                <div>
                  {order.completions.map((c) => (
                    <p key={c.station}>
                      {completionLabels[c.station]} · {c.employeeName} (
                      {c.employeeInitials}) · {dateTimeLabel(c.completedAt)}
                    </p>
                  ))}
                </div>
                <div className="inline-actions">
                  {station === 'cutting' && (
                    <Button asChild variant="outline">
                      <Link href={`/stations/cutting/${order.id}`}>
                        Open cutting sheet
                      </Link>
                    </Button>
                  )}
                  {station !== 'cutting' && (
                    <CompletionAction
                      station={station}
                      orderId={order.id}
                      orderNumber={order.orderNumber}
                      employeeId={employee.employeeId}
                      done={!!order[stamp[station]]}
                      onCompleted={employee.touch}
                    />
                  )}
                </div>
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
