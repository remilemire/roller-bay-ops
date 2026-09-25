'use client';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { useCanManage } from '@/features/auth';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Button } from '@/components/ui/button';
import { PageHeading } from '@/components/ui/feedback';
import { useListParams } from '@/lib/use-list-params';
import { OrderListView } from './order-list-view';
import { OrderMonthView } from './order-month-view';
import { OrderWeekView } from './order-week-view';

// The schedule opens on the current week; the list is the searchable table.
const views = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'list', label: 'List' },
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
        <SegmentedControl
          label="View"
          value={view}
          options={views}
          onChange={(value) =>
            params.set({ view: value === 'week' ? '' : value })
          }
        />
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
