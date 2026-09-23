'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  orderWorkflowContextSchema,
  orderWorkflowSchema,
  type OrderWorkflow,
} from '@roller-bay/shared/work-orders';
import { correctionResultSchema } from '@roller-bay/shared/corrections';
import type { z } from 'zod';
import { api } from '@/lib/api';
import { useIdempotentWrite } from '@/lib/use-idempotent-write';
import { useCurrentUser } from '@/features/auth/auth-boundary';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TextField, ChoiceField } from '@/components/ui/field';
import { ErrorNotice, Loading } from '@/components/ui/feedback';

type Context = z.infer<typeof orderWorkflowContextSchema>;
export function OrderCancellation({
  id,
  close,
  initialAction = 'cancel-order',
}: {
  id: string;
  close: () => void;
  initialAction?: OrderWorkflow['action'];
}) {
  const query = useQuery({
    queryKey: ['work-orders', id, 'cancellation-context'],
    queryFn: ({ signal }) =>
      api(
        `/work-orders/${id}/cancellation-context`,
        orderWorkflowContextSchema,
        { signal },
      ),
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title="Cancel or release work"
      description="Choose what to stop. Recorded production and completed stock results remain in history."
    >
      {query.data ? (
        <CancellationForm
          context={query.data}
          close={close}
          initialAction={initialAction}
        />
      ) : query.isPending ? (
        <Loading />
      ) : (
        <ErrorNotice error={query.error} />
      )}
    </Dialog>
  );
}
function CancellationForm({
  context,
  close,
  initialAction,
}: {
  context: Context;
  close: () => void;
  initialAction: OrderWorkflow['action'];
}) {
  const [original, setOriginal] = useState(context);
  const [action, setAction] = useState(initialAction);
  const [reason, setReason] = useState('');
  const [skip, setSkip] = useState(false);
  const [review, setReview] = useState<OrderWorkflow | null>(null);
  const [error, setError] = useState<unknown>(null);
  const user = useCurrentUser();
  const client = useQueryClient();
  const write = useIdempotentWrite({
    scope: `order-workflow:${user.id}:${original.order.id}`,
    path: `/work-orders/${original.order.id}/cancellation`,
    inputSchema: orderWorkflowSchema,
    outputSchema: correctionResultSchema,
    onSuccess: async () => {
      await Promise.all(
        [
          'work-orders',
          'allocations',
          'production',
          'stock-items',
          'history',
        ].map((key) => client.invalidateQueries({ queryKey: [key] })),
      );
      close();
    },
  });
  const body = review ?? write.pending;
  const outstanding =
    action !== 'unschedule' && original.outstandingCuttingResults;
  async function refresh() {
    try {
      const updated = await api(
        `/work-orders/${original.order.id}/cancellation-context`,
        orderWorkflowContextSchema,
      );
      setOriginal(updated);
      setSkip(false);
      setReview(null);
      setError(null);
      write.reset();
    } catch (e) {
      setError(e);
    }
  }
  return (
    <div className="stack">
      <p>
        <strong>Order {original.order.orderNumber}</strong>
      </p>
      {original.order.cancelledAt || original.order.shippedAt ? (
        <p>This order is already cancelled or shipped.</p>
      ) : null}
      {(error ?? write.error) != null && (
        <ErrorNotice error={error ?? write.error} />
      )}
      {write.pending && (
        <p className="notice">
          The previous request has an uncertain result. Retry the saved request
          before making another change.
        </p>
      )}
      {body ? (
        <>
          <h3>
            Review{' '}
            {body.action === 'cancel-order'
              ? 'cancellation'
              : body.action === 'unschedule'
                ? 'unscheduling'
                : 'fabric release'}
          </h3>
          <p>
            <strong>Reason:</strong> {body.reason}
          </p>
          <ul>
            <li>The schedule date will be cleared.</li>
            {body.action !== 'unschedule' && (
              <li>
                Fabric reservations will be released. The original allocation
                and cutting plan stay in history.
              </li>
            )}
            {body.action === 'cancel-order' && (
              <li>
                The order will be cancelled and removed from production queues.
              </li>
            )}
            <li>
              Recorded production milestones and reconciled stock results will
              be preserved.
            </li>
            {body.skipCuttingResults && (
              <li>
                Outstanding cutting results will be closed without recording
                measurements. Stock balances will stay unchanged and may
                overstate available fabric.
              </li>
            )}
          </ul>
          <div className="form-actions">
            <Button
              variant="outline"
              disabled={write.isPending || !!write.pending}
              onClick={() => setReview(null)}
            >
              Back
            </Button>
            <Button
              variant="destructive"
              disabled={write.isPending}
              onClick={() => write.mutate(body)}
            >
              {write.pending ? 'Retry saved request' : 'Confirm changes'}
            </Button>
          </div>
        </>
      ) : (
        <>
          <ChoiceField
            label="Action"
            value={action}
            onChange={(v) => {
              setAction(v as OrderWorkflow['action']);
              setSkip(false);
            }}
            options={[
              { value: 'unschedule', label: 'Unschedule only' },
              { value: 'release-allocation', label: 'Remove fabric plan' },
              { value: 'cancel-order', label: 'Cancel work order' },
            ]}
          />
          <p>
            {action === 'unschedule'
              ? 'Keep fabric reserved and leave production unchanged.'
              : action === 'release-allocation'
                ? 'Release fabric and clear the date. Keep the order open for another allocation.'
                : 'Stop the order, clear its date, and release its fabric reservations.'}
          </p>
          {outstanding && (
            <div className="notice stack">
              <p>
                There are outstanding cutting results. Resolve them first, or
                explicitly continue without recording measurements.
              </p>
              <Link
                className="text-link"
                href={
                  original.worksheet
                    ? `/stations/review?worksheet=${original.worksheet.id}`
                    : `/allocations/${original.allocation!.id}`
                }
              >
                Resolve cutting results
              </Link>
              <label className="correction-check">
                <input
                  type="checkbox"
                  checked={skip}
                  onChange={(e) => setSkip(e.target.checked)}
                />
                Continue without recording results. Release reservations and
                leave stock balances unchanged.
              </label>
            </div>
          )}
          <TextField
            label="Reason"
            value={reason}
            onChange={setReason}
            required
          />
          <div className="form-actions">
            <Button variant="outline" onClick={() => void refresh()}>
              Refresh current state
            </Button>
            <Button
              disabled={
                !reason.trim() ||
                (outstanding && !skip) ||
                !!original.order.cancelledAt ||
                !!original.order.shippedAt ||
                (action === 'unschedule' && !original.order.shipDate) ||
                (action === 'release-allocation' && !original.allocation)
              }
              onClick={() => {
                try {
                  setReview(
                    orderWorkflowSchema.parse({
                      action,
                      reason,
                      expectedRevision: original.order.revision,
                      allocationId: original.allocation?.id ?? null,
                      expectedAllocationRevision:
                        original.allocation?.revision ?? null,
                      worksheetId: original.worksheet?.id ?? null,
                      expectedWorksheetRevision:
                        original.worksheet?.revision ?? null,
                      skipCuttingResults: outstanding && skip,
                    }),
                  );
                  setError(null);
                } catch (e) {
                  setError(e);
                }
              }}
            >
              Review changes
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
