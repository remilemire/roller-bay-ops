'use client';
import Link from 'next/link';
import { TextField } from '@/components/ui/field';
import { allocationDetail } from '@/features/allocations/allocations.api';
import { CompletionEditor } from '@/features/allocations/completion-editor';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { worksheetSchema } from '@roller-bay/shared/production';
import { useCanManage } from '@/features/auth/auth-boundary';
import { useMeasurementUnits } from '@/features/users/use-measurement-units';
import { api } from '@/lib/api';
import { dateTimeLabel } from '@/lib/format';
import { RecordValues } from '@/features/audit/history';
import { Button } from '@/components/ui/button';
import { PageHeading, ErrorNotice, Loading } from '@/components/ui/feedback';
import { CuttingInstructions } from './cutting-instructions';
import { worksheets, worksheetDetail, productionKey } from './production.api';
export function CuttingReviewScreen() {
  return useCanManage() ? (
    <ReviewQueue />
  ) : (
    <p>Only admins can review cutting results.</p>
  );
}
function ReviewQueue() {
  const query = useQuery(worksheets());
  const [selected, setSelected] = useState('');
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
                        onClick={() => setSelected(s.id)}
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
      {selected && <ReviewWorksheet key={selected} id={selected} />}
    </div>
  );
}
function ReviewWorksheet({ id }: { id: string }) {
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
  const review = useMutation({
    mutationFn: () =>
      api(`/production/cutting/worksheets/${id}/review`, worksheetSchema, {
        method: 'POST',
        body: { expectedRevision: query.data!.revision },
      }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: productionKey }),
        client.invalidateQueries({ queryKey: ['allocations'] }),
        client.invalidateQueries({ queryKey: ['stock-items'] }),
      ]);
    },
  });
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorNotice error={query.error} />;
  const sheet = query.data;
  return (
    <section className="stack">
      <h2>Order {sheet.orderNumber}</h2>
      <CuttingInstructions
        allocation={sheet.snapshot}
        units={sheet.draft?.units ?? units}
        checked={sheet.draft?.checkedCuts ?? []}
      />
      <section className="panel panel-body">
        <h3>Submitted measurements</h3>
        {sheet.results ? (
          <RecordValues value={sheet.results.items} />
        ) : (
          <p>The cutter has not submitted complete measurements yet.</p>
        )}
        {review.error && <ErrorNotice error={review.error} />}
        <p>
          Accepting updates stock and creates retained remnants. It does not
          change production milestones.
        </p>
        <Button
          disabled={
            !sheet.submittedAt ||
            !!sheet.reviewedAt ||
            !!sheet.abandonedAt ||
            review.isPending
          }
          onClick={() => review.mutate()}
        >
          {sheet.reviewedAt
            ? 'Inventory reconciled'
            : review.isPending
              ? 'Reconciling…'
              : 'Accept and reconcile inventory'}
        </Button>
        {review.isSuccess && <p role="status">Inventory reconciled.</p>}
        {!sheet.reviewedAt && (
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
                    !reason.trim() || abandon.isPending || !!sheet.abandonedAt
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
                  returnResults.isPending
                }
                onClick={() => returnResults.mutate()}
              >
                Return for correction
              </Button>
              <Button
                variant="outline"
                disabled={!sheet.submittedAt || !reason.trim()}
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
          id={id}
          allocationId={sheet.allocationId}
          revision={sheet.revision}
          reason={reason}
          close={() => setResolving(false)}
        />
      )}
    </section>
  );
}

function ResolveWorksheet({
  id,
  allocationId,
  revision,
  reason,
  close,
}: {
  id: string;
  allocationId: string;
  revision: number;
  reason: string;
  close: () => void;
}) {
  const query = useQuery(allocationDetail(allocationId));
  const units = useMeasurementUnits();
  const client = useQueryClient();
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorNotice error={query.error} />;
  if (query.data.state !== 'active')
    return <p>This allocation is no longer active.</p>;
  return (
    <section className="panel panel-body">
      <h3>Resolve inventory discrepancy</h3>
      <p>
        Enter current physical measurements for every source. These explicitly
        replace the earlier observations for reconciliation. Original
        submissions remain in history. Reason: {reason}
      </p>
      <CompletionEditor
        allocation={query.data}
        close={close}
        worksheet={{
          initialForm: null,
          units,
          resolution: true,
          submit: async (results) => {
            await api(
              `/production/cutting/worksheets/${id}/review`,
              worksheetSchema,
              {
                method: 'POST',
                body: {
                  expectedRevision: revision,
                  resolution: { reason, results },
                },
              },
            );
            await Promise.all([
              client.invalidateQueries({ queryKey: productionKey }),
              client.invalidateQueries({ queryKey: ['allocations'] }),
              client.invalidateQueries({ queryKey: ['stock-items'] }),
            ]);
            close();
          },
        }}
      />
    </section>
  );
}
