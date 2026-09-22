'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { worksheetSchema, type Worksheet } from '@roller-bay/shared/production';
import { api } from '@/lib/api';
import { useCurrentUser } from '@/features/auth/auth-boundary';
import { useMeasurementUnits } from '@/features/users/use-measurement-units';
import { completionRecovery } from '@/features/allocations/completion-form';
import { CompletionEditor } from '@/features/allocations/completion-editor';
import { RecordValues } from '@/features/audit/history';
import { Button } from '@/components/ui/button';
import { PageHeading, Loading, ErrorNotice } from '@/components/ui/feedback';
import { CuttingInstructions } from './cutting-instructions';
import { EmployeeSelection, useEmployeeSelection } from './employee-selection';
import { CompletionAction } from './completion-action';
import {
  worksheetForOrder,
  productionKey,
  completions,
} from './production.api';
export function CuttingWorkspace({ orderId }: { orderId: string }) {
  const user = useCurrentUser();
  if (user.role === 'production' && !user.stations.includes('cutting'))
    return <p>This account is not assigned to cutting.</p>;
  return <CuttingOrder orderId={orderId} />;
}
function CuttingOrder({ orderId }: { orderId: string }) {
  const query = useQuery(worksheetForOrder(orderId));
  const client = useQueryClient();
  const employee = useEmployeeSelection();
  const start = useMutation({
    mutationFn: () =>
      api(`/production/cutting/orders/${orderId}/worksheet`, worksheetSchema, {
        method: 'POST',
        body: { employeeId: employee.employeeId },
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: productionKey });
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
      <section className="panel panel-body stack">
        <EmployeeSelection
          value={employee.employeeId}
          onChange={employee.selectEmployee}
        />
        {query.data ? (
          <CutCompletion sheet={query.data} employeeId={employee.employeeId} />
        ) : (
          <>
            <p>
              Beginning saves the current plan and prevents changes while it is
              being cut.
            </p>
            <Button
              disabled={!employee.employeeId || start.isPending}
              onClick={() => start.mutate()}
            >
              Begin cutting
            </Button>
            {start.error && <ErrorNotice error={start.error} />}
          </>
        )}
      </section>
      {query.data && <Worksheet key={query.data.id} initial={query.data} />}
    </div>
  );
}
function CutCompletion({
  sheet,
  employeeId,
}: {
  sheet: Worksheet;
  employeeId: string;
}) {
  const query = useQuery(completions(sheet.workOrderId));
  if (query.error) return <ErrorNotice error={query.error} />;
  const completed = query.data?.find((c) => c.station === 'cutting');
  return (
    <>
      {completed && (
        <p>
          Cut by {completed.employeeName} ({completed.employeeInitials})
        </p>
      )}
      {query.data && (
        <CompletionAction
          station="cutting"
          orderId={sheet.workOrderId}
          orderNumber={sheet.orderNumber}
          employeeId={employeeId}
          done={!!completed}
        />
      )}
      <p className="muted">
        Record completion when the whole order is cut. Measurements can be
        submitted separately.
      </p>
    </>
  );
}
function Worksheet({ initial }: { initial: Worksheet }) {
  // Keep dirty work pinned through background refetches. Explicit saves advance the revision.
  const [sheet, setSheet] = useState(initial);
  const [editorVersion, setEditorVersion] = useState(0);
  const [discardError, setDiscardError] = useState<unknown>(null);
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
    setDiscardError(null);
    await client.invalidateQueries({ queryKey: productionKey });
  };
  return (
    <>
      <p>
        Started by {sheet.employeeName} ({sheet.employeeInitials}) ·{' '}
        {sheet.reviewedAt
          ? 'Inventory reconciled'
          : sheet.submittedAt
            ? 'Results awaiting office review'
            : 'Results in progress'}
      </p>
      {discardError && <ErrorNotice error={discardError} />}
      <CuttingInstructions
        allocation={sheet.snapshot}
        units={units}
        checked={checked}
        onCheck={sheet.submittedAt ? undefined : setChecked}
      />
      {sheet.submittedAt ? (
        <section className="panel panel-body stack">
          <h2>Submitted measurements</h2>
          <RecordValues value={sheet.results?.items} />
        </section>
      ) : (
        <CompletionEditor
          key={editorVersion}
          onDirtyChange={setDirty}
          allocation={sheet.snapshot}
          close={() => void refresh().catch(setDiscardError)}
          worksheet={{
            dirty: checkedDirty,
            initialForm:
              sheet.draft?.form ??
              (sheet.results
                ? completionRecovery(sheet.results, sheet.snapshot, units)
                : null),
            units,
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
              const result = await api(
                `/production/cutting/worksheets/${sheet.id}/submit`,
                worksheetSchema,
                {
                  method: 'POST',
                  body: {
                    expectedRevision: sheet.revision,
                    results,
                    draft: { form, units, checkedCuts: checked },
                  },
                },
              );
              setDirty(false);
              setSheet(result);
            },
          }}
        />
      )}
    </>
  );
}
