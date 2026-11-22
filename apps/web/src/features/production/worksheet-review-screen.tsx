'use client';
import Link from 'next/link';
import { shortId } from '@/lib/format';
import { TextField } from '@/components/ui/field';
import {
  allocationDetail,
  type CompletionEditorProps,
} from '@/features/allocations';
import { useState, type ComponentType } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  worksheetSchema,
  worksheetReviewSchema,
} from '@roller-bay/shared/production';
import type { z } from 'zod';
import { useProductionWrite } from './use-production-write';
import { useCanManage, useCurrentUser } from '@/features/auth';
import { useMeasurementUnits } from '@/features/users';
import { api } from '@/lib/api';
import { SubmittedCuttingResults } from './submitted-cutting-results';
import { Button } from '@/components/ui/button';
import { PageHeading, ErrorNotice, Loading } from '@/components/ui/feedback';
import { CuttingInstructions } from './cutting-instructions';
import {
  worksheetDetail,
  productionKey,
  lookupCuttingLocations,
} from './production.api';
/** Allocations' results form, composed by the route. */
type Editor = { completionEditor: ComponentType<CompletionEditorProps> };
export function WorksheetReviewScreen({
  id,
  completionEditor,
}: {
  id: string;
} & Editor) {
  const user = useCurrentUser();
  const canManage = useCanManage();
  const query = useQuery(worksheetDetail(id));
  const units = useMeasurementUnits();
  const client = useQueryClient();
  const [reason, setReason] = useState('');
  const [editingResolution, setEditingResolution] = useState(false);
  const resolving = canManage && editingResolution;
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
      setEditingResolution(false);
      await Promise.all([
        client.invalidateQueries({ queryKey: productionKey }),
        client.invalidateQueries({ queryKey: ['allocations'] }),
        client.invalidateQueries({ queryKey: ['stock-items'] }),
      ]);
    },
  });
  if (query.isPending) return <Loading />;
  if (query.error && !query.data)
    return (
      <ErrorNotice error={query.error} retry={() => void query.refetch()} />
    );
  const sheet = query.data;
  const canCorrect =
    !sheet.reviewedAt &&
    !sheet.abandonedAt &&
    !sheet.skippedAt &&
    (!!sheet.submittedAt || canManage);
  return (
    <section className="stack">
      <PageHeading
        title={`${sheet.isRecut ? 'Recut' : 'Cutting'} results · ${sheet.orderNumber}`}
      />
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
      <section className="panel panel-body cutting-review-results">
        <h3>Submitted measurements</h3>
        {sheet.results ? (
          <SubmittedCuttingResults
            units={units}
            locationLabels={sheet.locationLabels}
            items={sheet.results.items}
          />
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
            <div className="inline-actions">
              <Button
                variant="outline"
                disabled={review.isPending}
                onClick={() => review.mutate(review.pending!)}
              >
                Retry original reconciliation
              </Button>
            </div>
          </>
        )}
        <div className="review-accept">
          <p className="review-help">
            Accept these measurements to update stock and save any retained
            remnants. Production milestones stay unchanged.
          </p>
          <div className="inline-actions">
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
              onClick={() =>
                review.mutate({ expectedRevision: sheet.revision })
              }
            >
              {sheet.reviewedAt
                ? 'Inventory reconciled'
                : review.isPending
                  ? 'Reconciling…'
                  : 'Accept and reconcile inventory'}
            </Button>
          </div>
          {review.isSuccess && <p role="status">Inventory reconciled.</p>}
          {sheet.reviewedAt && (
            <ReplanningNotice allocationId={sheet.allocationId} />
          )}
        </div>
        {canCorrect && (
          <div className="review-corrections">
            <h4>Correct these results</h4>
            <p className="review-help">
              {canManage
                ? 'Return the sheet to the cutter, or replace the results with verified measurements.'
                : 'Give the cutter a reason to correct and resubmit the worksheet.'}
            </p>
            <TextField
              label="Reason for correction"
              value={reason}
              onChange={setReason}
            />
            {returnResults.error && <ErrorNotice error={returnResults.error} />}
            {abandon.error && <ErrorNotice error={abandon.error} />}
            <div className="inline-actions">
              {canManage && !sheet.submittedAt && (
                <Button
                  variant="outline"
                  disabled={
                    !reason.trim() ||
                    abandon.isPending ||
                    !!review.pending ||
                    review.isPending ||
                    resolving
                  }
                  onClick={() => abandon.mutate()}
                >
                  Abandon unused sheet
                </Button>
              )}
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
              {canManage && (
                <Button
                  variant="outline"
                  disabled={
                    !sheet.submittedAt ||
                    !reason.trim() ||
                    !!review.pending ||
                    review.isPending
                  }
                  onClick={() => setEditingResolution(true)}
                >
                  Replace with new measurements
                </Button>
              )}
            </div>
          </div>
        )}
      </section>
      {resolving && (
        <ResolveWorksheet
          allocationId={sheet.allocationId}
          revision={sheet.revision}
          reason={reason}
          completionEditor={completionEditor}
          submit={(body) => review.mutateAsync(body).then(() => undefined)}
          close={() => setEditingResolution(false)}
        />
      )}
    </section>
  );
}

function ReplanningNotice({ allocationId }: { allocationId: string }) {
  const query = useQuery(allocationDetail(allocationId));
  if (query.isPending) return <Loading />;
  if (query.error)
    return (
      <ErrorNotice error={query.error} retry={() => void query.refetch()} />
    );
  const affected =
    query.data.state === 'completed'
      ? query.data.completion?.affectedAllocationIds
      : undefined;
  if (!affected?.length) return null;
  return (
    <div className="notice notice-warning" role="status">
      <div>
        <strong>
          Allocations flagged for replanning by this reconciliation
        </strong>
        <ul>
          {affected.map((id) => (
            <li key={id}>
              <Link className="text-link" href={`/allocations/${id}`}>
                View allocation {shortId(id)}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ResolveWorksheet({
  allocationId,
  revision,
  reason,
  close,
  submit,
  completionEditor: CompletionEditor,
}: {
  submit: (body: z.infer<typeof worksheetReviewSchema>) => Promise<void>;
  allocationId: string;
  revision: number;
  reason: string;
  close: () => void;
} & Editor) {
  const query = useQuery(allocationDetail(allocationId));
  const units = useMeasurementUnits();
  if (query.isPending) return <Loading />;
  if (query.error && !query.data)
    return (
      <ErrorNotice error={query.error} retry={() => void query.refetch()} />
    );
  if (query.data.state !== 'active')
    return <p>This allocation is no longer active.</p>;
  return (
    <section className="panel panel-body stack">
      <h3>Replace submitted measurements</h3>
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
