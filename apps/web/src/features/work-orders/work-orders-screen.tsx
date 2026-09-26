'use client';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useCanManage } from '@/features/auth';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Button } from '@/components/ui/button';
import { PageHeading } from '@/components/ui/feedback';
import { useListParams } from '@/lib/use-list-params';
import { useRememberedParam } from '@/lib/use-remembered-param';
import { OrderCreateDialog } from './order-create-dialog';
import { OrderListView } from './order-list-view';
import { OrderMonthView } from './order-month-view';
import { OrderWeekView } from './order-week-view';

// The list is the searchable table; week and month lay orders out by ship date.
const views = [
  { value: 'list', label: 'List' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
] as const;

export function WorkOrdersScreen() {
  const params = useListParams();
  const canManage = useCanManage();
  const [adding, setAdding] = useState(false);
  const { value: view } = useRememberedParam(
    'view',
    'roller-bay-work-orders-view',
    views.map((item) => item.value),
    'list',
  );
  return (
    <>
      <PageHeading title="Work orders">
        <SegmentedControl
          label="View"
          value={view ?? ''}
          options={views}
          onChange={(value) => params.set({ view: value })}
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
      ) : view === 'week' ? (
        <OrderWeekView canManage={canManage} />
      ) : null}
    </>
  );
}
