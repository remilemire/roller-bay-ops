'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { WorkOrder } from '@roller-bay/shared/work-orders';
import { History } from '@/features/audit/history';
import { useCanManage } from '@/features/auth/auth-boundary';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import {
  ErrorNotice,
  Loading,
  PageHeading,
  Status,
} from '@/components/ui/feedback';
import { calendarDateLabel, dateLabel } from '@/lib/format';
import { OrderEditor } from './order-editor';
import {
  deleteOrder,
  orderDetail,
  workOrdersKey,
  updateOrder,
} from './work-orders.api';

export function OrderDetailScreen({ id }: { id: string }) {
  const query = useQuery(orderDetail(id));
  if (query.isPending) return <Loading />;
  if (!query.data) return <ErrorNotice error={query.error} />;
  return (
    <>
      {query.error && (
        <ErrorNotice error={query.error} retry={() => void query.refetch()} />
      )}
      <OrderRecord order={query.data} />
    </>
  );
}
function OrderRecord({ order }: { order: WorkOrder }) {
  const canManage = useCanManage();
  const client = useQueryClient();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const ship = useMutation({
    mutationFn: () =>
      updateOrder(order.id, {
        expectedRevision: order.revision,
        shipped: !order.shippedAt,
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: workOrdersKey }),
  });
  const remove = useMutation({
    mutationFn: () => deleteOrder(order.id, order.revision),
    // Leave before refreshing: refetching this record would only report 404.
    onSuccess: () => {
      router.push('/work-orders');
      return client.invalidateQueries({
        queryKey: [...workOrdersKey, 'list'],
      });
    },
  });
  const milestone = (value: string | null) => (value ? dateLabel(value) : '—');
  return (
    <>
      <PageHeading
        eyebrow="PRODUCTION ORDER"
        title={order.orderNumber}
        description={`Ships ${calendarDateLabel(order.shipDate)}`}
      >
        <Status value={order.status} />
        {canManage && (
          <>
            <Button variant="outline" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button
              variant="outline"
              disabled={ship.isPending}
              onClick={() => ship.mutate()}
            >
              {ship.isPending
                ? 'Saving…'
                : order.shippedAt
                  ? 'Mark not shipped'
                  : 'Mark shipped'}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                remove.reset();
                setDeleting(true);
              }}
            >
              Delete
            </Button>
          </>
        )}
      </PageHeading>
      {ship.error && <ErrorNotice error={ship.error} />}
      <section className="panel">
        <div className="panel-body">
          <div className="details-grid">
            {[
              ['Blinds', String(order.quantity)],
              ['Scheduled', milestone(order.scheduledAt)],
              ['Allocated', milestone(order.allocatedAt)],
              ['Cut', milestone(order.cutAt)],
              ['Shipped', milestone(order.shippedAt)],
              ['Note', order.note ?? '—'],
            ].map(([label, value]) => (
              <div key={label}>
                <div className="detail-label">{label}</div>
                <div className="detail-value">{value}</div>
              </div>
            ))}
          </div>
          {order.allocatedAt && (
            <p style={{ marginTop: 24 }}>
              <Link
                className="text-link"
                href={`/allocations?state=all&search=${order.orderNumber}`}
              >
                View allocation
              </Link>
            </p>
          )}
        </div>
      </section>
      <History type="work-orders" id={order.id} />
      {editing && <OrderEditor order={order} close={() => setEditing(false)} />}
      <Dialog
        open={deleting}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleting(false);
        }}
        title={`Delete order ${order.orderNumber}?`}
        description="An order with an allocation cannot be deleted; cancel the allocation first. Adding the order number again restores a deleted order."
      >
        {remove.error && <ErrorNotice error={remove.error} />}
        <div className="form-actions">
          <Button
            variant="outline"
            disabled={remove.isPending}
            onClick={() => setDeleting(false)}
          >
            Keep order
          </Button>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            {remove.isPending ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
