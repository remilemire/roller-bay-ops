'use client';
import Link from 'next/link';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GripVertical, Plus } from 'lucide-react';
import { useId, useState } from 'react';
import type { ScheduledOrder } from '@roller-bay/shared/order-schedule';
import { ErrorNotice, Loading, Status } from '@/components/ui/feedback';
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
import { OrderCalendarNav, orderTotals } from './order-calendar-nav';
import {
  orderRange,
  orderScheduleKey,
  updateOrder,
} from './order-schedule.api';

export function OrderWeekView({
  canManage,
  onAdd,
}: {
  canManage: boolean;
  onAdd?: (shipDate: string) => void;
}) {
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
  const client = useQueryClient();
  // The day a dropped order is shown on until the refreshed week replaces it.
  const [moved, setMoved] = useState<{ id: string; shipDate: string } | null>(
    null,
  );
  const [dragging, setDragging] = useState<ScheduledOrder | null>(null);
  const move = useMutation({
    mutationFn: ({
      order,
      shipDate,
    }: {
      order: ScheduledOrder;
      shipDate: string;
    }) => updateOrder(order.id, { expectedRevision: order.revision, shipDate }),
    // A refused move puts the order back where the server has it.
    onSettled: async () => {
      await client.invalidateQueries({ queryKey: orderScheduleKey });
      setMoved(null);
    },
  });
  const orders = (query.data ?? []).map((order) =>
    order.id === moved?.id ? { ...order, shipDate: moved.shipDate } : order,
  );
  const find = (orderId: unknown) =>
    orders.find((order) => order.id === orderId);
  // Step a whole day at a time: columns are far wider than an arrow-key nudge.
  const keyboardCoordinates: KeyboardCoordinateGetter = (
    event,
    { context, currentCoordinates },
  ) => {
    if (event.code !== 'ArrowLeft' && event.code !== 'ArrowRight') return;
    event.preventDefault();
    const { active, over, collisionRect, droppableRects } = context;
    if (!active || !collisionRect) return;
    const from = days.indexOf(String(over?.id ?? find(active.id)?.shipDate));
    const next = days[from + (event.code === 'ArrowRight' ? 1 : -1)];
    const target = next && droppableRects.get(next);
    if (!target) return;
    return {
      x:
        currentCoordinates.x +
        target.left +
        target.width / 2 -
        collisionRect.left -
        collisionRect.width / 2,
      y: currentCoordinates.y,
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
    if (!order || !over || over.id === order.shipDate) return;
    const shipDate = String(over.id);
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
      />
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
          collisionDetection={closestCenter}
          accessibility={{
            screenReaderInstructions: {
              draggable:
                'Press Space to pick up this order, use Left and Right to choose a day, then Space to drop. Press Escape to cancel.',
            },
            announcements: {
              // Picking up is at once followed by the day the order is over,
              // which would replace a separate pickup message unread.
              onDragStart: () => undefined,
              onDragOver: ({ active, over }) =>
                over
                  ? `Order ${find(active.id)?.orderNumber} over ${calendarDateLabel(String(over.id))}.`
                  : undefined,
              onDragEnd: ({ active, over }) =>
                over
                  ? `Order ${find(active.id)?.orderNumber} dropped on ${calendarDateLabel(String(over.id))}.`
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
          <div className="week-board">
            {days.map((day) => (
              <WeekDay
                key={day}
                day={day}
                orders={orders
                  .filter((order) => order.shipDate === day)
                  .sort((a, b) => a.orderNumber.localeCompare(b.orderNumber))}
                canManage={canManage}
                busy={busy}
                onAdd={onAdd}
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

function WeekDay({
  day,
  orders,
  canManage,
  busy,
  onAdd,
}: {
  day: string;
  orders: ScheduledOrder[];
  canManage: boolean;
  busy: boolean;
  onAdd?: (shipDate: string) => void;
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
        {onAdd && (
          <button
            type="button"
            className="button button-ghost button-icon"
            aria-label={`Add order on ${calendarDateLabel(day)}`}
            onClick={() => onAdd(day)}
          >
            <Plus size={16} />
          </button>
        )}
      </header>
      <div className="week-day-body">
        {orders.length ? (
          <ul>
            {orders.map((order) => (
              <li key={order.id}>
                <DraggableOrder
                  order={order}
                  canManage={canManage}
                  busy={busy}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No orders</p>
        )}
      </div>
      {/* The day's totals; the week's are above the board. */}
      <footer>
        <span>
          <strong>{orders.length}</strong>{' '}
          {orders.length === 1 ? 'order' : 'orders'}
        </span>
      </footer>
    </section>
  );
}

function DraggableOrder({
  order,
  canManage,
  busy,
}: {
  order: ScheduledOrder;
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
        hidden={isDragging}
        handle={
          // The handle stays mounted while a move saves, so it keeps focus.
          canManage && (
            <button
              ref={setActivatorNodeRef}
              type="button"
              className="order-card-handle"
              aria-label={`Move order ${order.orderNumber} to another day`}
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
  handle,
  hidden = false,
  overlay = false,
}: {
  order: ScheduledOrder;
  handle?: React.ReactNode;
  hidden?: boolean;
  overlay?: boolean;
}) {
  return (
    <div
      className={cn(
        'order-card',
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
            <Link href={`/order-schedule/${order.id}`}>
              <strong>{order.orderNumber}</strong>
            </Link>
          )}
          <Status value={order.status} />
        </div>
        {order.note && <small>{order.note}</small>}
      </div>
    </div>
  );
}
