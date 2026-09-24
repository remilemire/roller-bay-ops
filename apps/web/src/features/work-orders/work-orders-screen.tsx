'use client';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { useCanManage } from '@/features/auth';
import { Button } from '@/components/ui/button';
import { PageHeading } from '@/components/ui/feedback';
import { useListParams } from '@/lib/use-list-params';
import { OrderListView } from './order-list-view';
import { OrderMonthView } from './order-month-view';
import { OrderWeekView } from './order-week-view';

// The schedule opens on the current week; the list is the searchable table.
const views = [
  { value: 'list', label: 'List' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];
export function WorkOrdersScreen() {
  const params = useListParams();
  const canManage = useCanManage();
  const view = views.some((item) => item.value === params.get('view'))
    ? params.get('view')
    : 'week';
  return (
    <>
      <PageHeading title="Work orders">
        <div className="tabs" role="group" aria-label="View">
          {views.map((item) => (
            <button
              key={item.value}
              className={`tab ${view === item.value ? 'active' : ''}`}
              aria-pressed={view === item.value}
              onClick={() =>
                params.set({ view: item.value === 'week' ? '' : item.value })
              }
            >
              {item.label}
            </button>
          ))}
        </div>
        {/* An order starts where its blinds are entered and its fabric
            allocated; it reaches this schedule once that is done. */}
        <Button asChild>
          <Link href="/allocations/new">
            <Plus size={17} />
            New order
          </Link>
        </Button>
      </PageHeading>
      {view === 'list' ? (
        <OrderListView canManage={canManage} />
      ) : view === 'month' ? (
        <OrderMonthView />
      ) : (
        <OrderWeekView canManage={canManage} />
      )}
    </>
  );
}
