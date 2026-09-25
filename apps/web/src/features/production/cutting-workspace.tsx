'use client';
import Link from 'next/link';
import { useState, type ComponentType } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  worksheetSchema,
  type Worksheet,
  type WorksheetSubmit,
} from '@roller-bay/shared/production';
import { api } from '@/lib/api';
import { useCurrentUser } from '@/features/auth';
import { useMeasurementUnits } from '@/features/users';
import {
  completionRecovery,
  type CompletionEditorProps,
} from '@/features/allocations';
import { RecordValues } from '@/components/records/record-values';
import { Button } from '@/components/ui/button';
import { PageHeading, Loading, ErrorNotice } from '@/components/ui/feedback';
import { CuttingInstructions } from './cutting-instructions';
import { EmployeeSelection } from './employee-selection';
import { Dialog } from '@/components/ui/dialog';
import {
  worksheetForOrder,
  productionKey,
  completions,
  employeeNames,
  lookupCuttingLocations,
} from './production.api';
/** Allocations' results form, composed by the route. */
type Editor = { completionEditor: ComponentType<CompletionEditorProps> };
export function CuttingWorkspace({
  orderId,
  completionEditor,
}: { orderId: string } & Editor) {
  const user = useCurrentUser();
  if (user.role === 'production' && !user.stations.includes('cutting'))
    return <p>This account is not assigned to cutting.</p>;
  return <CuttingOrder orderId={orderId} completionEditor={completionEditor} />;
}
function CuttingOrder({
  orderId,
  completionEditor,
}: { orderId: string } & Editor) {
  const query = useQuery(worksheetForOrder(orderId));
  const client = useQueryClient();
  const [beginOpen, setBeginOpen] = useState(false);
  const [starterIds, setStarterIds] = useState<string[]>([]);
  const starter = starterIds.length === 1 ? starterIds[0] : undefined;
  const start = useMutation({
    mutationFn: () =>
      api(`/production/cutting/orders/${orderId}/worksheet`, worksheetSchema, {
        method: 'POST',
        body: { employeeId: starter },
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: productionKey });
      setBeginOpen(false);
    },
  });
  if (query.isPending) return <Loading />;
  if (query.error && !query.data) return <ErrorNotice error={query.error} />;
  return (
    <div className="stack station-workspace">
      <PageHeading
        title={
          query.data ? `Cutting · ${query.data.orderNumber}` : 'Cutting sheet'
        }
      >
        <Button asChild variant="outline">
          <Link href="/stations?station=cutting">Back to cutting</Link>
        </Button>
      </PageHeading>
      {!query.data && (
        <section className="panel panel-body stack">
          <p>
            Beginning saves the current plan and prevents changes while it is
            being cut.
          </p>
          <div className="action-group">
            <Button
              onClick={() => {
                setStarterIds([]);
                setBeginOpen(true);
              }}
            >
              Begin cutting
            </Button>
          </div>
          <Dialog
            open={beginOpen}
            onOpenChange={setBeginOpen}
            title="Begin cutting"
            description="Choose the cutter who is starting this worksheet. Completion is recorded separately when you sign off or submit results."
          >
            <div className="stack">
              <EmployeeSelection
                label="Started by"
                value={starterIds}
                onChange={setStarterIds}
              />
              {start.error && <ErrorNotice error={start.error} />}
              <div className="form-actions">
                <Button
                  disabled={!starter || start.isPending}
                  onClick={() => start.mutate()}
                >
                  Start worksheet
                </Button>
              </div>
            </div>
          </Dialog>
        </section>
      )}
      {query.data && <CutAttribution sheet={query.data} />}
      {query.data && (
        <Worksheet
          key={query.data.id}
          initial={query.data}
          completionEditor={completionEditor}
        />
      )}
    </div>
  );
}
function CutAttribution({ sheet }: { sheet: Worksheet }) {
  const query = useQuery(completions(sheet.workOrderId));
  if (query.error) return <ErrorNotice error={query.error} />;
  const completed = query.data?.find((c) => c.station === 'cutting');
  return completed ? <p>Cut by {employeeNames(completed.employees)}</p> : null;
}
function Worksheet({
  initial,
  completionEditor: CompletionEditor,
}: { initial: Worksheet } & Editor) {
  // Keep dirty work pinned through background refetches. Explicit saves advance the revision.
  const [sheet, setSheet] = useState(initial);
  const [employeeIds, setEmployeeIds] = useState<string[]>([]);
  const [editorVersion, setEditorVersion] = useState(0);
  const [refreshError, setRefreshError] = useState<unknown>(null);
  const [checked, setChecked] = useState(initial.draft?.checkedCuts ?? []);
  const liveUnits = useMeasurementUnits();
  const [units, setUnits] = useState(initial.draft?.units ?? liveUnits);
  const [dirty, setDirty] = useState(false);
  const checkedDirty =
    JSON.stringify([...checked].sort()) !==
    JSON.stringify([...(sheet.draft?.checkedCuts ?? [])].sort());
  // A clean view follows office returns/reviews. Dirty drafts keep their original revision.
  if (!dirty && !checkedDirty && initial.revision > sheet.revision) {
    setSheet(initial);
    setChecked(initial.draft?.checkedCuts ?? []);
    setUnits(initial.draft?.units ?? liveUnits);
    setEditorVersion((value) => value + 1);
  }
  const client = useQueryClient();
  const refresh = async () => {
    const result = await api(
      `/production/cutting/worksheets/${sheet.id}`,
      worksheetSchema,
    );
    setSheet(result);
    setChecked(result.draft?.checkedCuts ?? []);
    setUnits(result.draft?.units ?? liveUnits);
    setDirty(false);
    setEditorVersion((v) => v + 1);
    setRefreshError(null);
    await client.invalidateQueries({ queryKey: productionKey });
  };
  return (
    <>
      <p>
        Started by {sheet.employeeName} ({sheet.employeeInitials}) ·{' '}
        {sheet.skippedAt
          ? 'Closed without recording results'
          : sheet.reviewedAt
            ? 'Inventory reconciled'
            : sheet.submittedAt
              ? 'Results awaiting office review'
              : 'Results in progress'}
      </p>
      {refreshError && <ErrorNotice error={refreshError} />}
      <CuttingInstructions
        allocation={sheet.snapshot}
        units={units}
        checked={checked}
        onCheck={sheet.submittedAt || sheet.skippedAt ? undefined : setChecked}
      />
      {sheet.skippedAt ? (
        <p className="notice">
          This worksheet was closed without recording results. Stock balances
          were left unchanged.
        </p>
      ) : sheet.submittedAt ? (
        <section className="panel panel-body stack">
          <h2>Submitted measurements</h2>
          <RecordValues units={liveUnits} value={sheet.results?.items} />
        </section>
      ) : (
        <CompletionEditor
          key={editorVersion}
          onDirtyChange={setDirty}
          allocation={sheet.snapshot}
          close={() => void refresh().catch(setRefreshError)}
          worksheet={{
            confirmationFields: (
              <EmployeeSelection
                value={employeeIds}
                onChange={setEmployeeIds}
              />
            ),
            submissionDisabled: employeeIds.length === 0,
            dirty: checkedDirty,
            initialForm:
              sheet.draft?.form ??
              (sheet.results
                ? completionRecovery(sheet.results, sheet.snapshot, units)
                : null),
            units,
            lookupLocations: lookupCuttingLocations,
            saveDraft: async (form) => {
              const result = await api(
                `/production/cutting/worksheets/${sheet.id}/draft`,
                worksheetSchema,
                {
                  method: 'PUT',
                  body: {
                    expectedRevision: sheet.revision,
                    draft: { form, units, checkedCuts: checked },
                  },
                },
              );
              setSheet(result);
            },
            submit: async (results, form) => {
              if (!employeeIds.length)
                throw new Error(
                  'Select the employees who completed the cutting.',
                );
              const result = await api(
                `/production/cutting/worksheets/${sheet.id}/submit`,
                worksheetSchema,
                {
                  method: 'POST',
                  body: {
                    expectedRevision: sheet.revision,
                    employeeIds,
                    results,
                    draft: { form, units, checkedCuts: checked },
                  } satisfies WorksheetSubmit,
                },
              );
              setDirty(false);
              setSheet(result);
              await Promise.all([
                client.invalidateQueries({ queryKey: productionKey }),
                client.invalidateQueries({ queryKey: ['work-orders'] }),
              ]);
            },
          }}
        />
      )}
    </>
  );
}
