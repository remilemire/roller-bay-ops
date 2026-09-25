'use client';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useCanManage } from '@/features/auth';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Button } from '@/components/ui/button';
import { PageHeading } from '@/components/ui/feedback';
import { useListParams } from '@/lib/use-list-params';
import { OrderCreateDialog } from './order-create-dialog';
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
  const [adding, setAdding] = useState(false);
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
        {/* Adding an order allocates nothing; it waits under To allocate,
            and gets a date once its fabric is allocated. */}
        <Button onClick={() => setAdding(true)}>
          <Plus size={17} />
          New order
        </Button>
      </PageHeading>
      {adding && (
        <OrderCreateDialog
          close={() => setAdding(false)}
          onCreated={() => setAdding(false)}
        />
      )}
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
