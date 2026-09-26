'use client';
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useCanManage } from '@/features/auth';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Button } from '@/components/ui/button';
import { PageHeading } from '@/components/ui/feedback';
import { useHydrated } from '@/lib/use-hydrated';
import { useListParams } from '@/lib/use-list-params';
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
type View = (typeof views)[number]['value'];
const isView = (value: string | null): value is View =>
  views.some((item) => item.value === value);

// The browser remembers the last view, so a bare /work-orders reopens it. The
// URL still names the view shown, so a link or reload always means one view.
const viewStorageKey = 'roller-bay-work-orders-view';
function savedView(): View {
  try {
    const saved = localStorage.getItem(viewStorageKey);
    if (isView(saved)) return saved;
  } catch {
    // Storage can be blocked; the list is the default.
  }
  return 'list';
}

export function WorkOrdersScreen() {
  const params = useListParams();
  const canManage = useCanManage();
  const hydrated = useHydrated();
  const [adding, setAdding] = useState(false);
  const named = params.get('view');
  // Storage is browser-only, so the first render waits for it rather than
  // guessing a view the server cannot know.
  const view = isView(named) ? named : hydrated ? savedView() : null;
  useEffect(() => {
    if (isView(named)) {
      try {
        localStorage.setItem(viewStorageKey, named);
      } catch {
        // Blocked storage only loses the preference.
      }
    } else if (view) params.set({ view, page: params.get('page') });
  }, [named, view, params]);
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
