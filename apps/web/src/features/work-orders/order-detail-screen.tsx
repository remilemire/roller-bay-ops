'use client';
import { AllocationWarning } from './allocation-warning';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import {
  orderQuantitySchema,
  type WorkOrder,
} from '@roller-bay/shared/work-orders';
import { useCanManage } from '@/features/auth';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import {
  ErrorNotice,
  Loading,
  PageHeading,
  Status,
} from '@/components/ui/feedback';
import { calendarDateLabel, dateLabel } from '@/lib/format';
import { OrderField } from './order-field';
import { OrderReschedule, scheduleLabel } from './order-reschedule';
import { deleteOrder, orderDetail, workOrdersKey } from './work-orders.api';

/** Other features' sections of an order, composed by the route. */
type OrderSections = {
  history: ReactNode;
  production: (order: WorkOrder) => ReactNode;
  cancellation: (close: () => void) => ReactNode;
};
export function OrderDetailScreen({
  id,
  ...sections
}: { id: string } & OrderSections) {
  const query = useQuery(orderDetail(id));
  if (query.isPending) return <Loading />;
  if (!query.data)
    return (
      <ErrorNotice error={query.error} retry={() => void query.refetch()} />
    );
  return (
    <>
      {query.error && (
        <ErrorNotice error={query.error} retry={() => void query.refetch()} />
      )}
      <OrderRecord order={query.data} {...sections} />
    </>
  );
}
function OrderRecord({
  order,
  history,
  production,
  cancellation,
}: { order: WorkOrder } & OrderSections) {
  const canManage = useCanManage();
  const client = useQueryClient();
  const router = useRouter();
  const [cancelling, setCancelling] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [deleting, setDeleting] = useState(false);
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
  const editable = canManage && !order.cancelledAt;
  return (
    <div className="stack">
      <PageHeading
        eyebrow="PRODUCTION ORDER"
        title={order.orderNumber}
        description={
          order.shipDate
            ? `Ships ${calendarDateLabel(order.shipDate)}`
            : 'No ship date'
        }
      >
        <Status value={order.status} />
        {canManage && !order.cancelledAt && (
          <>
            {!order.allocatedAt &&
              !order.shipDate &&
              !order.cutAt &&
              !order.assembledAt &&
              !order.checkedAt &&
              !order.shippedAt && (
                <Button
                  variant="outline"
                  onClick={() => {
                    remove.reset();
                    setDeleting(true);
                  }}
                >
                  Delete
                </Button>
              )}
            {!order.shippedAt && (
              <Button variant="outline" onClick={() => setCancelling(true)}>
                Cancel work order
              </Button>
            )}
            {/* An order without fabric is scheduled as a back order. */}
            {!order.shippedAt && (
              <Button
                variant={order.allocatedAt ? 'default' : 'outline'}
                onClick={() => setRescheduling(true)}
              >
                {scheduleLabel(order)}
              </Button>
            )}
          </>
        )}
        {!order.allocatedAt && !order.cancelledAt && !order.shippedAt && (
          <Button asChild>
            <Link href={`/allocations/new?workOrder=${order.id}`}>
              Allocate
            </Link>
          </Button>
        )}
      </PageHeading>
      <AllocationWarning order={order} />
      <section className="panel">
        <div className="panel-body stack">
          <div className="details-grid">
            {/* An order's own fields are edited where they are shown. */}
            <OrderField
              order={order}
              field="quantity"
              label="Blinds"
              display={String(order.quantity)}
              // Its allocation's blinds were checked against the count.
              editable={editable && !order.allocatedAt}
              note={
                editable && order.allocatedAt
                  ? "Can't be changed while the order has an allocation."
                  : undefined
              }
              inputMode="numeric"
              maxLength={5}
              sanitize={(text) => text.replace(/\D/g, '')}
              validate={(text) =>
                orderQuantitySchema.safeParse(Number(text)).success
                  ? undefined
                  : 'Enter a whole number from 1 to 10,000.'
              }
              body={(text) => ({ quantity: Number(text) })}
            />
            {[
              ['Created', milestone(order.createdAt)],
              ['Allocated', milestone(order.allocatedAt)],
              ['Scheduled', milestone(order.scheduledAt)],
              ['Cut', milestone(order.cutAt)],
              ['Assembled', milestone(order.assembledAt)],
              ['Checked', milestone(order.checkedAt)],
              ['Shipped', milestone(order.shippedAt)],
              // Kept after allocation, as a record of where the fabric came from.
              ...(order.backOrder
                ? [
                    [
                      'Back-order POs',
                      order.backOrder.purchaseOrderNumbers
                        .map(
                          (number) =>
                            `${number} (${order.backOrder!.awaitingPurchaseOrderNumbers.includes(number) ? 'awaited' : 'received'})`,
                        )
                        .join(', '),
                    ],
                  ]
                : []),
            ].map(([label, value]) => (
              <div key={label}>
                <div className="detail-label">{label}</div>
                <div className="detail-value">{value}</div>
              </div>
            ))}
            <OrderField
              order={order}
              field="note"
              label="Note"
              display={order.note ?? '—'}
              editable={editable}
              maxLength={1000}
              body={(note) => ({ note })}
            />
          </div>
          {order.allocatedAt && (
            <p>
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
      {(order.allocatedAt ||
        order.cutAt ||
        order.assembledAt ||
        order.checkedAt) &&
        production(order)}
      {order.cancelledAt && (
        <p className="notice">Cancelled: {order.cancellationReason}</p>
      )}
      {history}
      {cancelling && cancellation(() => setCancelling(false))}
      {rescheduling && (
        <OrderReschedule order={order} close={() => setRescheduling(false)} />
      )}
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
    </div>
  );
}
