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

/** Steps the week and month views through time and names the period shown. */
export function OrderCalendarNav({
  period,
  label,
  summary,
  isCurrent,
  onStep,
  onCurrent,
}: {
  period: 'week' | 'month';
  label: string;
  summary: string;
  isCurrent: boolean;
  onStep: (direction: -1 | 1) => void;
  onCurrent: () => void;
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
      <Button variant="outline" disabled={isCurrent} onClick={onCurrent}>
        This {period}
      </Button>
    </div>
  );
}
