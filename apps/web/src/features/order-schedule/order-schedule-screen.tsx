'use client';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useCanManage } from '@/features/auth/auth-boundary';
import { Button } from '@/components/ui/button';
import { PageHeading } from '@/components/ui/feedback';
import { useListParams } from '@/lib/use-list-params';
import { OrderEditor } from './order-editor';
import { OrderListView } from './order-list-view';
import { OrderMonthView } from './order-month-view';
import { OrderWeekView } from './order-week-view';

// The schedule opens on the current week; the list is the searchable table.
const views = [
  { value: 'list', label: 'List' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];
export function OrderScheduleScreen() {
  const params = useListParams();
  const canManage = useCanManage();
  // The week and month views add an order to the day it was added from.
  const [adding, setAdding] = useState<{ shipDate: string } | null>(null);
  const view = views.some((item) => item.value === params.get('view'))
    ? params.get('view')
    : 'week';
  const add = canManage
    ? (shipDate: string) => setAdding({ shipDate })
    : undefined;
  return (
    <>
      <PageHeading title="Order schedule">
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
        {add && (
          <Button onClick={() => add('')}>
            <Plus size={17} />
            Add order
          </Button>
        )}
      </PageHeading>
      {view === 'list' ? (
        <OrderListView canManage={canManage} />
      ) : view === 'month' ? (
        <OrderMonthView onAdd={add} />
      ) : (
        <OrderWeekView canManage={canManage} onAdd={add} />
      )}
      {adding && (
        <OrderEditor shipDate={adding.shipDate} close={() => setAdding(null)} />
      )}
    </>
  );
}
