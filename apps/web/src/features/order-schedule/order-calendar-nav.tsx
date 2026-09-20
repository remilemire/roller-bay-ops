import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  orderStatusSchema,
  type ScheduledOrder,
} from '@roller-bay/shared/order-schedule';
import { Button } from '@/components/ui/button';

/** `12 orders · 5 scheduled · 4 allocated · 3 shipped`; empty statuses drop out. */
export function orderTotals(orders: ScheduledOrder[]) {
  const total = `${orders.length} ${orders.length === 1 ? 'order' : 'orders'}`;
  const byStatus = orderStatusSchema.options
    .map((status) => ({
      status,
      count: orders.filter((order) => order.status === status).length,
    }))
    .filter(({ count }) => count)
    .map(({ status, count }) => `${count} ${status}`);
  return [total, ...byStatus].join(' · ');
}

/**
 * Steps the week and month views through time and names the period shown.
 * Today sits between the arrows, as it does in most calendars, so it reads
 * as the third way to move rather than as a label.
 */
export function OrderCalendarNav({
  period,
  label,
  summary,
  onStep,
  onToday,
}: {
  period: 'week' | 'month';
  label: string;
  summary: string;
  onStep: (direction: -1 | 1) => void;
  onToday: () => void;
}) {
  return (
    <div className="toolbar">
      <div className="calendar-nav">
        <Button
          variant="outline"
          size="icon"
          aria-label={`Previous ${period}`}
          onClick={() => onStep(-1)}
        >
          <ChevronLeft size={17} />
        </Button>
        <Button
          variant="outline"
          title={`Go to this ${period}`}
          onClick={onToday}
        >
          Today
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label={`Next ${period}`}
          onClick={() => onStep(1)}
        >
          <ChevronRight size={17} />
        </Button>
        <div>
          <h2 aria-live="polite">{label}</h2>
          <p className="muted">{summary}</p>
        </div>
      </div>
    </div>
  );
}
