'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { stationSchema, type Station } from '@roller-bay/shared/users';
import { useCurrentUser, useCanManage } from '@/features/auth';
import { useListParams } from '@/lib/use-list-params';
import { calendarDateLabel, dateTimeLabel } from '@/lib/format';
import { ChoiceField, TextField } from '@/components/ui/field';
import { Dialog } from '@/components/ui/dialog';
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
              <Link
                key={value}
                href={`/stations?station=${value}`}
                className="panel station-choice"
              >
                {stationLabels[value]}
              </Link>
            ))}
        </nav>
      </div>
    );
  return (
    <div className="station-workspace">
      <PageHeading title={`${stationLabels[station]} station`}>
        {allowed.length > 1 && (
          <StationSwitcher
            key={`${station}:${allowed.join(',')}`}
            station={station}
            allowed={allowed}
            onChange={(next) =>
              params.set({ station: next, search: '', page: 1, view: 'queue' })
            }
          />
        )}
        {manage}
      </PageHeading>
      <StationQueue key={station} station={station} />
    </div>
  );
}
function StationSwitcher({
  station,
  allowed,
  onChange,
}: {
  station: Station;
  allowed: readonly Station[];
  onChange: (station: Station) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState('');
  const parsed = stationSchema.safeParse(selected);
  const next =
    parsed.success && parsed.data !== station && allowed.includes(parsed.data)
      ? parsed.data
      : null;
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setSelected('');
          setOpen(true);
        }}
      >
        Change station
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Change station"
        description={`Currently recording for ${stationLabels[station]}.`}
      >
        <div className="stack">
          <ChoiceField
            label="Switch to station"
            value={selected}
            onChange={setSelected}
            placeholder="Choose station"
            options={allowed
              .filter((value) => value !== station)
              .map((value) => ({ value, label: stationLabels[value] }))}
          />
          {next && (
            <p>New completions will be recorded as {completionLabels[next]}.</p>
          )}
        </div>
        <div className="form-actions">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={!next}
            onClick={() => {
              if (!next) return;
              onChange(next);
              setOpen(false);
            }}
          >
            {next ? `Switch to ${stationLabels[next]}` : 'Switch station'}
          </Button>
        </div>
      </Dialog>
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
    <div className="stack">
      <section className="panel panel-body stack">
        <div className="form-grid">
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
        </div>
        <div className="tabs" role="group" aria-label="Order view">
          {(['queue', 'completed', 'all'] as const).map((v) => (
            <button
              key={v}
              className={`tab ${view === v ? 'active' : ''}`}
              aria-pressed={view === v}
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
                {order.completions.length > 0 && (
                  <div className="record-list">
                    {order.completions.map((c) => (
                      <p key={c.station}>
                        {completionLabels[c.station]} · {c.employeeName} (
                        {c.employeeInitials}) · {dateTimeLabel(c.completedAt)}
                      </p>
                    ))}
                  </div>
                )}
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
