'use client';
import Link from 'next/link';
import { TextField } from '@/components/ui/field';
import { allocationDetail } from '@/features/allocations/allocations.api';
import type { CompletionEditorProps } from '@/features/allocations/completion-editor';
import { useState, type ComponentType } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  worksheetSchema,
  worksheetReviewSchema,
} from '@roller-bay/shared/production';
import type { z } from 'zod';
import { useListParams } from '@/lib/use-list-params';
import { useProductionWrite } from './use-production-write';
import { useCanManage, useCurrentUser } from '@/features/auth/auth-boundary';
import { useMeasurementUnits } from '@/features/users/use-measurement-units';
import { api } from '@/lib/api';
import { dateTimeLabel } from '@/lib/format';
import { RecordValues } from '@/components/records/record-values';
import { Button } from '@/components/ui/button';
import { PageHeading, ErrorNotice, Loading } from '@/components/ui/feedback';
import { CuttingInstructions } from './cutting-instructions';
import {
  worksheets,
  worksheetDetail,
  productionKey,
  lookupCuttingLocations,
} from './production.api';
/** Allocations' results form, composed by the route. */
type Editor = { completionEditor: ComponentType<CompletionEditorProps> };
export function CuttingReviewScreen({ completionEditor }: Editor) {
  return useCanManage() ? (
    <ReviewQueue completionEditor={completionEditor} />
  ) : (
    <p>Only admins can review cutting results.</p>
  );
}
function ReviewQueue({ completionEditor }: Editor) {
  const query = useQuery(worksheets());
  const params = useListParams();
  const selected = params.get('worksheet');
  const [dirty, setDirty] = useState(false);
  return (
    <div className="stack">
      <PageHeading title="Review cutting results">
        <Button asChild variant="outline">
          <Link href="/stations">Back to stations</Link>
        </Button>
      </PageHeading>
      {query.isPending ? (
        <Loading />
      ) : query.error ? (
        <ErrorNotice error={query.error} />
      ) : (
        <section className="panel">
          <div className="data-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Started by</th>
                  <th>Started</th>
                  <th>Results</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {query.data.map((s) => (
                  <tr key={s.id}>
                    <td>{s.orderNumber}</td>
                    <td>
                      {s.employeeName} ({s.employeeInitials})
                    </td>
                    <td>{dateTimeLabel(s.startedAt)}</td>
                    <td>{s.submittedAt ? 'Awaiting review' : 'Incomplete'}</td>
                    <td>
                      <Button
                        variant="outline"
                        onClick={() => {
                          if (s.id === selected) return;
                          if (
                            dirty &&
                            !window.confirm(
                              'Discard your unsaved cutting results?',
                            )
                          )
                            return;
                          setDirty(false);
                          params.set({ worksheet: s.id });
                        }}
                      >
                        Open
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!query.data.length && (
              <p className="panel-body">No cutting results awaiting review.</p>
            )}
          </div>
        </section>
      )}
      {selected && (
        <ReviewWorksheet
          key={selected}
          id={selected}
          onDirtyChange={setDirty}
          completionEditor={completionEditor}
        />
      )}
    </div>
  );
}
function ReviewWorksheet({
  id,
  onDirtyChange,
  completionEditor,
}: {
  id: string;
  onDirtyChange: (dirty: boolean) => void;
} & Editor) {
  const user = useCurrentUser();
  const query = useQuery(worksheetDetail(id));
  const units = useMeasurementUnits();
  const client = useQueryClient();
  const [reason, setReason] = useState('');
  const [resolving, setResolving] = useState(false);
  const abandon = useMutation({
    mutationFn: () =>
      api(`/production/cutting/worksheets/${id}/abandon`, worksheetSchema, {
        method: 'POST',
        body: { expectedRevision: query.data!.revision, reason },
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: productionKey }),
  });
  const returnResults = useMutation({
    mutationFn: () =>
      api(`/production/cutting/worksheets/${id}/return`, worksheetSchema, {
        method: 'POST',
        body: { expectedRevision: query.data!.revision, reason },
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: productionKey }),
  });
  const review = useProductionWrite({
    scope: `cutting-review:${user.id}:${id}`,
    path: `/production/cutting/worksheets/${id}/review`,
    inputSchema: worksheetReviewSchema,
    outputSchema: worksheetSchema,
    onSuccess: async () => {
      setResolving(false);
      onDirtyChange(false);
      await Promise.all([
        client.invalidateQueries({ queryKey: productionKey }),
        client.invalidateQueries({ queryKey: ['allocations'] }),
        client.invalidateQueries({ queryKey: ['stock-items'] }),
      ]);
    },
  });
  if (query.isPending) return <Loading />;
  if (query.error && !query.data) return <ErrorNotice error={query.error} />;
  const sheet = query.data;
  return (
    <section className="stack">
      <h2>Order {sheet.orderNumber}</h2>
      {sheet.skippedAt && (
        <p className="notice">
          These cutting results were closed without recording measurements.
          Stock balances were left unchanged.
        </p>
      )}
      <CuttingInstructions
        allocation={sheet.snapshot}
        units={sheet.draft?.units ?? units}
        checked={sheet.draft?.checkedCuts ?? []}
      />
      <section className="panel panel-body stack">
        <h3>Submitted measurements</h3>
        {sheet.results ? (
          <RecordValues units={units} value={sheet.results.items} />
        ) : (
          <p>The cutter has not submitted complete measurements yet.</p>
        )}
        {review.error && <ErrorNotice error={review.error} />}
        {review.pending && (
          <>
            <p>
              The previous reconciliation has an uncertain result. Retry its
              saved measurements and reason before making another change.
            </p>
            <Button
              variant="outline"
              disabled={review.isPending}
              onClick={() => review.mutate(review.pending!)}
            >
              Retry original reconciliation
            </Button>
          </>
        )}
        <p>
          Accepting updates stock and creates retained remnants. It does not
          change production milestones.
        </p>
        <Button
          disabled={
            !sheet.submittedAt ||
            !!sheet.reviewedAt ||
            !!sheet.abandonedAt ||
            !!sheet.skippedAt ||
            review.isPending ||
            !!review.pending ||
            resolving
          }
          onClick={() => review.mutate({ expectedRevision: sheet.revision })}
        >
          {sheet.reviewedAt
            ? 'Inventory reconciled'
            : review.isPending
              ? 'Reconciling…'
              : 'Accept and reconcile inventory'}
        </Button>
        {review.isSuccess && <p role="status">Inventory reconciled.</p>}
        {!sheet.reviewedAt && !sheet.skippedAt && (
          <>
            <TextField
              label="Reason for returning or resolving results"
              value={reason}
              onChange={setReason}
            />
            {returnResults.error && <ErrorNotice error={returnResults.error} />}
            <div className="inline-actions">
              {!sheet.submittedAt && (
                <Button
                  variant="outline"
                  disabled={
                    !reason.trim() ||
                    abandon.isPending ||
                    !!sheet.abandonedAt ||
                    !!sheet.skippedAt ||
                    !!review.pending ||
                    review.isPending ||
                    resolving
                  }
                  onClick={() => abandon.mutate()}
                >
                  Abandon unused sheet
                </Button>
              )}
              {abandon.error && <ErrorNotice error={abandon.error} />}
              <Button
                variant="outline"
                disabled={
                  !sheet.submittedAt ||
                  !reason.trim() ||
                  returnResults.isPending ||
                  !!review.pending ||
                  review.isPending ||
                  resolving
                }
                onClick={() => returnResults.mutate()}
              >
                Return for correction
              </Button>
              <Button
                variant="outline"
                disabled={
                  !sheet.submittedAt ||
                  !reason.trim() ||
                  !!review.pending ||
                  review.isPending
                }
                onClick={() => setResolving(true)}
              >
                Resolve with current measurements
              </Button>
            </div>
          </>
        )}
      </section>
      {resolving && (
        <ResolveWorksheet
          allocationId={sheet.allocationId}
          revision={sheet.revision}
          reason={reason}
          onDirtyChange={onDirtyChange}
          completionEditor={completionEditor}
          submit={(body) => review.mutateAsync(body).then(() => undefined)}
          close={() => {
            setResolving(false);
            onDirtyChange(false);
          }}
        />
      )}
    </section>
  );
}

function ResolveWorksheet({
  allocationId,
  revision,
  reason,
  close,
  submit,
  onDirtyChange,
  completionEditor: CompletionEditor,
}: {
  submit: (body: z.infer<typeof worksheetReviewSchema>) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
  allocationId: string;
  revision: number;
  reason: string;
  close: () => void;
} & Editor) {
  const query = useQuery(allocationDetail(allocationId));
  const units = useMeasurementUnits();
  if (query.isPending) return <Loading />;
  if (query.error && !query.data) return <ErrorNotice error={query.error} />;
  if (query.data.state !== 'active')
    return <p>This allocation is no longer active.</p>;
  return (
    <section className="panel panel-body stack">
      <h3>Resolve inventory discrepancy</h3>
      <p>
        Enter current physical measurements for every source. These explicitly
        replace the earlier observations for reconciliation. Original
        submissions remain in history. Reason: {reason}
      </p>
      <CompletionEditor
        allocation={query.data}
        close={close}
        onDirtyChange={onDirtyChange}
        worksheet={{
          initialForm: null,
          units,
          lookupLocations: lookupCuttingLocations,
          resolution: true,
          submit: async (results) => {
            await submit({
              expectedRevision: revision,
              resolution: { reason, results },
            });
          },
        }}
      />
    </section>
  );
}
