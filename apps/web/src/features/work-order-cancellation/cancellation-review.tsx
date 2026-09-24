'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  orderCancellationContextSchema,
  orderCancellationSchema,
  type OrderCancellation,
} from '@roller-bay/shared/work-orders';
import { correctionResultSchema } from '@roller-bay/shared/corrections';
import type { z } from 'zod';
import { api, ApiError } from '@/lib/api';
import { useIdempotentWrite } from '@/lib/use-idempotent-write';
import { useCurrentUser } from '@/features/auth/auth-boundary';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/field';
import { ErrorNotice, Loading } from '@/components/ui/feedback';
import { calendarDateLabel } from '@/lib/format';

type Context = z.infer<typeof orderCancellationContextSchema>;
/** Shared review UI; each feature opens its own fixed cancellation action. */
export function CancellationReview({
  id,
  kind,
  close,
}: {
  id: string;
  kind: 'order' | 'allocation';
  close: () => void;
}) {
  const resource = kind === 'order' ? 'work-orders' : 'allocations';
  const path = `/${resource}/${id}`;
  const [busy, setBusy] = useState(false);
  const query = useQuery({
    queryKey: [resource, id, 'cancellation-context'],
    queryFn: ({ signal }) =>
      api(`${path}/cancellation-context`, orderCancellationContextSchema, {
        signal,
      }),
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
      title={`Cancel ${kind === 'order' ? 'work order' : 'allocation'}${query.data ? ` ${query.data.order.orderNumber}` : ''}?`}
    >
      {query.data ? (
        <CancellationForm
          context={query.data}
          path={path}
          kind={kind}
          close={close}
          setBusy={setBusy}
        />
      ) : query.isPending ? (
        <Loading />
      ) : (
        <ErrorNotice error={query.error} retry={() => void query.refetch()} />
      )}
    </Dialog>
  );
}
function CancellationForm({
  context,
  path,
  kind,
  close,
  setBusy,
}: {
  context: Context;
  path: string;
  kind: 'order' | 'allocation';
  close: () => void;
  setBusy: (busy: boolean) => void;
}) {
  const [original, setOriginal] = useState(context);
  const [reason, setReason] = useState('');
  const [skip, setSkip] = useState(false);
  const [review, setReview] = useState<OrderCancellation | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [changed, setChanged] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const user = useCurrentUser();
  const client = useQueryClient();
  const write = useIdempotentWrite({
    scope: `cancel:${kind}:${user.id}:${path}`,
    path: `${path}/cancellation`,
    inputSchema: orderCancellationSchema,
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
  const body = write.pending ?? review;
  const closed = !!original.order.cancelledAt || !!original.order.shippedAt;
  const busy = write.isPending || refreshing;
  async function confirm(input: OrderCancellation) {
    setBusy(true);
    try {
      await write.mutateAsync(input);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // The server rejected this request before mutation. Keep the reason,
        // fetch a fresh preview and require a new review of its consequences.
        setRefreshing(true);
        setReview(null);
        setSkip(false);
        try {
          setOriginal(
            await api(
              `${path}/cancellation-context`,
              orderCancellationContextSchema,
            ),
          );
          setChanged(true);
          setError(null);
          write.reset();
        } catch (refreshError) {
          setError(refreshError);
        } finally {
          setRefreshing(false);
        }
      }
    } finally {
      setBusy(false);
    }
  }
  const consequences = (
    <ul className="cancellation-consequences">
      {kind === 'order' ? (
        <>
          <li>The work order will stop and leave production queues.</li>
          <li>
            {original.order.shipDate
              ? `The ship date (${calendarDateLabel(original.order.shipDate)}) will be cleared.`
              : 'The order will have no ship date.'}
          </li>
        </>
      ) : (
        <li>
          The work order stays open.
          {original.order.shipDate
            ? ` Its ship date stays ${calendarDateLabel(original.order.shipDate)} and it will be flagged as needing fabric.`
            : ''}
        </li>
      )}
      <li>
        Fabric reservations will be released. The original cutting plan stays in
        history.
      </li>
      <li>
        Recorded production and completed stock results will be preserved.
      </li>
      {body?.skipCuttingResults && (
        <li>
          Outstanding cutting results will be closed without recording
          measurements. Stock balances will stay unchanged and may overstate
          available fabric.
        </li>
      )}
    </ul>
  );
  return (
    <div className="cancellation-form">
      {closed && <p>This work order is already cancelled or shipped.</p>}
      {changed && (
        <p className="cancellation-message" role="status">
          This order changed. Review the updated details before cancelling. Your
          reason has been kept.
        </p>
      )}
      {(error ?? write.error) != null && (
        <ErrorNotice error={error ?? write.error} />
      )}
      {refreshing && <Loading label="Loading updated details…" />}
      {write.pending && (
        <p className="cancellation-message">
          The previous request has an uncertain result. Retry the saved request
          before making another change.
        </p>
      )}
      {body ? (
        <>
          <h3>Review cancellation</h3>
          <p>
            <strong>Reason:</strong> {body.reason}
          </p>
          {consequences}
          <div className="form-actions">
            <Button
              variant="outline"
              disabled={busy || !!write.pending}
              onClick={() => setReview(null)}
            >
              Back
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => void confirm(body)}
            >
              {write.pending
                ? 'Retry saved request'
                : kind === 'order'
                  ? 'Cancel work order'
                  : 'Cancel allocation'}
            </Button>
          </div>
        </>
      ) : (
        <>
          {consequences}
          {original.outstandingCuttingResults && (
            <div className="cancellation-warning">
              <strong>Outstanding cutting results</strong>
              <p>
                Resolve the results first, or continue without updating stock
                measurements.
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
              <label className="cancellation-check">
                <input
                  type="checkbox"
                  checked={skip}
                  disabled={busy}
                  onChange={(e) => setSkip(e.target.checked)}
                />
                <span>
                  Continue without recording results. Stock balances will stay
                  unchanged and may overstate available fabric.
                </span>
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
            <Button variant="outline" disabled={busy} onClick={close}>
              {kind === 'order' ? 'Keep work order' : 'Keep allocation'}
            </Button>
            <Button
              disabled={
                busy ||
                closed ||
                !reason.trim() ||
                (original.outstandingCuttingResults && !skip)
              }
              onClick={() => {
                try {
                  setReview(
                    orderCancellationSchema.parse({
                      reason,
                      expectedRevision: original.order.revision,
                      allocationId: original.allocation?.id ?? null,
                      expectedAllocationRevision:
                        original.allocation?.revision ?? null,
                      worksheetId: original.worksheet?.id ?? null,
                      expectedWorksheetRevision:
                        original.worksheet?.revision ?? null,
                      skipCuttingResults:
                        original.outstandingCuttingResults && skip,
                    }),
                  );
                  setError(null);
                } catch (e) {
                  setError(e);
                }
              }}
            >
              Review cancellation
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
