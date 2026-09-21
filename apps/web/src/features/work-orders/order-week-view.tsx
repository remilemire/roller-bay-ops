'use client';
import Link from 'next/link';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  type CollisionDetection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GripVertical } from 'lucide-react';
import { useId, useState } from 'react';
import type { WorkOrder } from '@roller-bay/shared/work-orders';
import { ErrorNotice, Loading, Status } from '@/components/ui/feedback';
import { SearchForm } from '@/components/ui/search-toolbar';
import {
  addDays,
  isDay,
  mondayOf,
  nextWeekday,
  today,
  workWeek,
} from '@/lib/calendar-dates';
import { calendarDateLabel, dayLabel, weekdayLabel } from '@/lib/format';
import { useListParams } from '@/lib/use-list-params';
import { cn } from '@/lib/utils';
import { OrderCalendarNav } from './order-calendar-nav';
import {
  blindCount,
  orderCount,
  orderTotals,
  totalBlinds,
} from './order-totals';
import {
  orderList,
  orderRange,
  unscheduledOrders,
  updateOrder,
  workOrdersKey,
} from './work-orders.api';

// The pointer decides where a card lands: a tray card is wider than a day, so
// its centre can sit over the neighbouring one. The keyboard has no pointer
// and falls back to the nearest centre.
const dropTarget: CollisionDetection = (args) => {
  const under = pointerWithin(args);
  return under.length ? under : closestCenter(args);
};
// The tray's droppable id; every other droppable is a day.
const TRAY = 'unscheduled';
const placeLabel = (id: unknown) =>
  id === TRAY ? 'the orders to schedule' : calendarDateLabel(String(id));

export function OrderWeekView({ canManage }: { canManage: boolean }) {
  const id = useId();
  const params = useListParams();
  // On a weekend the working week ahead is the useful one.
  const thisWeek = mondayOf(nextWeekday(today()));
  const monday = isDay(params.get('week'))
    ? mondayOf(params.get('week'))
    : thisWeek;
  const days = workWeek(monday);
  const friday = days[4]!;
  const query = useQuery(orderRange(monday, friday));
  // A search narrows the tray, which can hold a hundred orders, and marks its
  // matches on the days, which stay whole so their totals still mean the day.
  const search = params.search;
  // Allocated orders with no date yet wait in a tray above the board.
  const waiting = useQuery(unscheduledOrders(search));
  // Matches this page does not show: on another week, or not allocated yet.
  const found = useQuery({
    ...orderList({ search, pageSize: ELSEWHERE + 1 }),
    enabled: !!search,
  });
  const client = useQueryClient();
  // Where a dropped order is shown until the refreshed data replaces it; a
  // null date is the tray.
  const [moved, setMoved] = useState<{
    id: string;
    shipDate: string | null;
  } | null>(null);
  const [dragging, setDragging] = useState<WorkOrder | null>(null);
  const move = useMutation({
    mutationFn: ({
      order,
      shipDate,
    }: {
      order: WorkOrder;
      shipDate: string | null;
    }) => updateOrder(order.id, { expectedRevision: order.revision, shipDate }),
    // A refused move puts the order back where the server has it.
    onSettled: async () => {
      await client.invalidateQueries({ queryKey: workOrdersKey });
      setMoved(null);
    },
  });
  const place = (order: WorkOrder) =>
    order.id === moved?.id ? { ...order, shipDate: moved.shipDate } : order;
  // An order moved off this week, or out of the tray, still belongs to the
  // list it was read from until the refresh.
  // Keyed by id: between the two refreshes an order can be in both lists.
  const all = [
    ...new Map(
      [...(waiting.data?.items ?? []), ...(query.data ?? [])].map((order) => [
        order.id,
        order,
      ]),
    ).values(),
  ].map(place);
  const orders = all.filter((order) => order.shipDate !== null);
  const tray = all.filter((order) => order.shipDate === null);
  const find = (orderId: unknown) => all.find((order) => order.id === orderId);
  const mark = (order: WorkOrder) =>
    !search ? undefined : order.orderNumber.includes(search) ? 'match' : 'dim';
  const marked = all.filter((order) => mark(order) === 'match').length;
  const elsewhere = (found.data?.items ?? []).filter(
    (order) => !find(order.id),
  );
  // The tray comes before Monday for the arrow keys.
  const stops = [TRAY, ...days];
  // Step a whole day at a time: columns are far wider than an arrow-key nudge.
  const keyboardCoordinates: KeyboardCoordinateGetter = (
    event,
    { context, currentCoordinates },
  ) => {
    if (event.code !== 'ArrowLeft' && event.code !== 'ArrowRight') return;
    event.preventDefault();
    const { active, over, collisionRect, droppableRects } = context;
    if (!active || !collisionRect) return;
    const from = stops.indexOf(
      String(over?.id ?? find(active.id)?.shipDate ?? TRAY),
    );
    const next = stops[from + (event.code === 'ArrowRight' ? 1 : -1)];
    const target = next && droppableRects.get(next);
    if (!target) return;
    // The tray sits above the board, so a step may move down as well as across.
    return {
      x:
        currentCoordinates.x +
        target.left +
        target.width / 2 -
        collisionRect.left -
        collisionRect.width / 2,
      y:
        currentCoordinates.y +
        target.top +
        target.height / 2 -
        collisionRect.top -
        collisionRect.height / 2,
    };
  };
  const sensors = useSensors(
    // A short drag threshold keeps a click on an order's link a click.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates }),
  );
  // One move at a time: the next drag needs the revision this one returns.
  const busy = move.isPending;
  const finish = ({ active, over }: DragEndEvent) => {
    setDragging(null);
    const order = find(active.id);
    if (!order || !over || over.id === (order.shipDate ?? TRAY)) return;
    const shipDate = over.id === TRAY ? null : String(over.id);
    setMoved({ id: order.id, shipDate });
    move.mutate({ order, shipDate });
  };
  const year = friday.slice(0, 4);
  return (
    <>
      <OrderCalendarNav
        period="week"
        label={`${dayLabel(monday)} – ${dayLabel(friday)}, ${year}`}
        summary={query.data ? orderTotals(orders) : 'Loading…'}
        onStep={(direction) =>
          params.set({ week: addDays(monday, direction * 7) })
        }
        onToday={() => params.set({ week: '' })}
      >
        <SearchForm
          key={search}
          search={search}
          // The API caps the search at an order number's six characters.
          onSearch={(text) => params.set({ search: text.trim().slice(0, 6) })}
          placeholder="Find order number…"
        />
      </OrderCalendarNav>
      {search && found.data && (
        <p className="order-find" role="status">
          <span>
            {marked
              ? `${orderCount(marked)} marked on this page.`
              : `Nothing on this page matches ${search}.`}
          </span>
          {elsewhere.length > 0 && <span>Elsewhere:</span>}
          {elsewhere.slice(0, ELSEWHERE).map((order) => {
            const { href, label } = whereabouts(order, search);
            return (
              <Link key={order.id} className="text-link" href={href}>
                {order.orderNumber} · {label}
              </Link>
            );
          })}
          {elsewhere.length > ELSEWHERE && (
            <Link
              className="text-link"
              href={`/work-orders?view=list&status=all&search=${search}`}
            >
              All {found.data.total} matches
            </Link>
          )}
        </p>
      )}
      {move.error && <ErrorNotice error={move.error} />}
      <span className="sr-only" role="status">
        {move.isPending
          ? 'Rescheduling…'
          : move.isSuccess
            ? 'Rescheduled.'
            : ''}
      </span>
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorNotice error={query.error} retry={() => void query.refetch()} />
      ) : (
        <DndContext
          id={id}
          sensors={sensors}
          collisionDetection={dropTarget}
          accessibility={{
            screenReaderInstructions: {
              draggable:
                'Press Space to pick up this order, use Left and Right to choose a day or the orders to schedule, then Space to drop. Press Escape to cancel.',
            },
            announcements: {
              // Picking up is at once followed by the day the order is over,
              // which would replace a separate pickup message unread.
              onDragStart: () => undefined,
              onDragOver: ({ active, over }) =>
                over
                  ? `Order ${find(active.id)?.orderNumber} over ${placeLabel(over.id)}.`
                  : undefined,
              onDragEnd: ({ active, over }) =>
                over
                  ? `Order ${find(active.id)?.orderNumber} dropped on ${placeLabel(over.id)}.`
                  : undefined,
              onDragCancel: () => 'Rescheduling cancelled.',
            },
          }}
          onDragStart={({ active }) => {
            move.reset();
            setDragging(find(active.id) ?? null);
          }}
          onDragCancel={() => setDragging(null)}
          onDragEnd={finish}
        >
          <WeekTray
            orders={tray}
            search={search}
            mark={mark}
            total={waiting.data?.total ?? 0}
            error={waiting.error}
            canManage={canManage}
            busy={busy}
          />
          <div className="week-board">
            {days.map((day) => (
              <WeekDay
                key={day}
                day={day}
                orders={orders
                  .filter((order) => order.shipDate === day)
                  .sort(byNumber)}
                mark={mark}
                canManage={canManage}
                busy={busy}
              />
            ))}
          </div>
          <DragOverlay>
            {dragging && (
              <OrderCard
                order={dragging}
                overlay
                handle={
                  <span className="order-card-handle" aria-hidden>
                    <GripVertical size={15} />
                  </span>
                }
              />
            )}
          </DragOverlay>
        </DndContext>
      )}
    </>
  );
}

const byNumber = (a: WorkOrder, b: WorkOrder) =>
  a.orderNumber.localeCompare(b.orderNumber);
// How many matches from off the page are named before the list takes over.
const ELSEWHERE = 5;
type Mark = (order: WorkOrder) => 'match' | 'dim' | undefined;
/** Where to go for a match this page does not show. */
const whereabouts = (order: WorkOrder, search: string) =>
  order.shipDate
    ? {
        label: calendarDateLabel(order.shipDate),
        href: `/work-orders?week=${order.shipDate}&search=${search}`,
      }
    : order.status === 'new'
      ? {
          label: 'to allocate',
          href: `/allocations/new?workOrder=${order.id}`,
        }
      : { label: order.status, href: `/work-orders/${order.id}` };

/** Allocated orders waiting for a ship date: drag one onto a day to set it. */
function WeekTray({
  orders,
  search,
  mark,
  total,
  error,
  canManage,
  busy,
}: {
  orders: WorkOrder[];
  search: string;
  mark: Mark;
  total: number;
  error: unknown;
  canManage: boolean;
  busy: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: TRAY });
  return (
    <section
      ref={setNodeRef}
      className={cn('week-tray panel', isOver && 'is-over')}
      aria-label="To schedule"
    >
      <header>
        <strong>To schedule</strong>
        <small>
          {orderCount(orders.length)} · {blindCount(totalBlinds(orders))}
        </small>
      </header>
      {error ? (
        <ErrorNotice error={error} />
      ) : orders.length ? (
        <ul>
          {[...orders].sort(byNumber).map((order) => (
            <li key={order.id}>
              <DraggableOrder
                order={order}
                mark={mark(order)}
                canManage={canManage}
                busy={busy}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">
          {search
            ? `No order waiting for a ship date matches ${search}.`
            : 'No allocated orders are waiting for a ship date.'}
        </p>
      )}
      {total > orders.length && (
        <Link
          href={`/work-orders?view=list&status=unscheduled${search && `&search=${search}`}`}
        >
          All {total} orders to schedule
        </Link>
      )}
    </section>
  );
}

function WeekDay({
  day,
  orders,
  mark,
  canManage,
  busy,
}: {
  day: string;
  orders: WorkOrder[];
  mark: Mark;
  canManage: boolean;
  busy: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: day });
  return (
    <section
      ref={setNodeRef}
      className={cn('week-day panel', isOver && 'is-over')}
      aria-label={calendarDateLabel(day)}
      aria-current={day === today() ? 'date' : undefined}
    >
      <header>
        <div>
          <span className="week-day-name">{weekdayLabel(day)}</span>
          <strong className="week-day-date">{dayLabel(day)}</strong>
        </div>
      </header>
      <div className="week-day-body">
        {orders.length > 0 && (
          <ul>
            {orders.map((order) => (
              <li key={order.id}>
                <DraggableOrder
                  order={order}
                  mark={mark(order)}
                  canManage={canManage}
                  busy={busy}
                />
              </li>
            ))}
          </ul>
        )}
        {!orders.length && <p className="muted">No orders</p>}
      </div>
      {/* The day's totals; the week's are above the board. */}
      <footer>
        <span>
          <strong>{orders.length}</strong>{' '}
          {orders.length === 1 ? 'order' : 'orders'}
        </span>
        <span>
          <strong>{totalBlinds(orders)}</strong>{' '}
          {totalBlinds(orders) === 1 ? 'blind' : 'blinds'}
        </span>
      </footer>
    </section>
  );
}

function DraggableOrder({
  order,
  mark,
  canManage,
  busy,
}: {
  order: WorkOrder;
  mark: ReturnType<Mark>;
  canManage: boolean;
  busy: boolean;
}) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, isDragging } =
    useDraggable({ id: order.id, disabled: !canManage || busy });
  // The pointer drags the whole card; the keyboard uses the handle, which is
  // the activator, so Enter on the order's link still follows the link.
  return (
    <div ref={setNodeRef} {...(canManage ? listeners : {})}>
      <OrderCard
        order={order}
        mark={mark}
        hidden={isDragging}
        handle={
          // The handle stays mounted while a move saves, so it keeps focus.
          canManage && (
            <button
              ref={setActivatorNodeRef}
              type="button"
              className="order-card-handle"
              aria-label={`Move order ${order.orderNumber} to a day`}
              {...attributes}
            >
              <GripVertical size={15} />
            </button>
          )
        }
      />
    </div>
  );
}

function OrderCard({
  order,
  mark,
  handle,
  hidden = false,
  overlay = false,
}: {
  order: WorkOrder;
  mark?: ReturnType<Mark>;
  handle?: React.ReactNode;
  hidden?: boolean;
  overlay?: boolean;
}) {
  return (
    <div
      className={cn(
        'order-card',
        mark && `is-${mark}`,
        hidden && 'is-dragging',
        overlay && 'is-overlay',
      )}
    >
      {handle}
      <div>
        <div className="order-card-title">
          {overlay ? (
            <strong>{order.orderNumber}</strong>
          ) : (
            <Link href={`/work-orders/${order.id}`}>
              <strong>{order.orderNumber}</strong>
            </Link>
          )}
          <Status value={order.status} />
        </div>
        <small>
          {blindCount(order.quantity)}
          {order.note && ` · ${order.note}`}
        </small>
      </div>
    </div>
  );
}
