'use client';
import { ApiError } from '@/lib/api';
import { RequirementsEditor } from './requirements-editor';
import { CutPlanEditor } from './cut-plan-editor';
import { PlanPreview } from './plan-preview';
import { useRef, useState, useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import type { ErrorIssue } from '@roller-bay/shared/errors';
import {
  allocationDraftSchema,
  allocationDraftInputSchema,
  createAllocationSchema,
  type AllocationDetail,
  type AllocationOptimization,
  type AllocationValidation,
} from '@roller-bay/shared/allocations';
import { Save, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorNotice, PageHeading } from '@/components/ui/feedback';
import type { WorkOrderLine } from '@roller-bay/shared/work-orders';
import {
  orderDetail,
  saveOrderLines,
  workOrdersKey,
} from '@/features/work-orders/work-orders.api';
import { stockKey } from '@/features/stock-items/stock-items.api';
import { useCurrentUser } from '@/features/auth/auth-boundary';
import { useMeasurementUnits } from '@/features/users/use-measurement-units';
import {
  pendingPayload,
  requestKey,
  finishRequest,
} from '@/lib/pending-request';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import { issuePath } from '@/lib/errors';
import { showFieldIssues } from '@/lib/field-issues';
import {
  allocationFormSchema,
  allocationFieldName,
  allocationToForm,
  allocationFromForm,
  linesToRows,
  rowsToLines,
  type AllocationForm,
} from './allocation-form';
import {
  allocationDetail,
  createAllocationDraft,
  saveAllocationDraft,
  submitAllocation,
  replaceAllocation,
  deleteAllocationDraft,
  optimizeAllocation,
  validateAllocation,
  allocationKey,
} from './allocations.api';
/**
 * A form opens on an existing order, a shared draft or the active plan it
 * edits. Creating the order comes first, as a request of its own.
 */
type Opening =
  | { workOrderId: string; initial?: never; active?: never }
  | {
      initial: z.infer<typeof allocationDraftSchema>;
      workOrderId?: never;
      active?: never;
    }
  | { active: AllocationDetail; workOrderId?: never; initial?: never };
export function AllocationEditor({
  workOrderId,
  initial,
  active,
  close,
  onSubmitted,
}: Opening & {
  close?: () => void;
  onSubmitted?: () => void;
}) {
  const user = useCurrentUser();
  // Pin the units this form opened with: a session refetch must not relabel
  // or reinterpret dirty input.
  const liveUnits = useMeasurementUnits();
  const [units] = useState(liveUnits);
  const scope = `allocation:${user.id}:new`;
  // The pending create request belongs to the blank form that sent it;
  // saved drafts and active plans must neither offer to restore it nor clear it.
  const ownsPending = !initial && !active;
  const recovery = allocationDraftInputSchema.safeParse(
    ownsPending ? pendingPayload(scope) : undefined,
  );
  // Stored cut lengths are derived; edits resubmit only the assignments.
  const opened = active ?? initial;
  const openedData = opened && {
    workOrderId: opened.workOrderId,
    plan: {
      cuts: (active ? active.plan : initial!.data.plan).cuts.map(
        ({ stockItemId, items }) => ({ stockItemId, items }),
      ),
    },
  };
  const form = useForm<AllocationForm>({
    resolver: zodResolver(allocationFormSchema),
    defaultValues: allocationToForm(
      // An order asked for by name comes before an earlier request to
      // restore: saving then refuses until that request is dealt with.
      openedData ??
        (workOrderId
          ? { workOrderId, plan: { cuts: [] } }
          : recovery.success
            ? recovery.data
            : undefined),
      // The blinds it was read with, until the order itself is read below.
      // An order's blinds are complete, whatever the looser read shape allows.
      (active?.requirements ?? initial?.data.requirements ?? []).flatMap(
        ({ id, fabricColorId, widthMm, lengthMm, quantity }) =>
          fabricColorId && widthMm && lengthMm && quantity
            ? [{ id, fabricColorId, widthMm, lengthMm, quantity }]
            : [],
      ),
      units,
    ),
  });
  const values = useWatch({ control: form.control }) as AllocationForm;
  const [saved, setSaved] = useState(initial);
  const [confirm, setConfirm] = useState<'submit' | 'delete' | null>(null);
  const [validationError, setValidationError] = useState<unknown>(null);
  const [preview, setPreview] = useState<
    AllocationOptimization | AllocationValidation | null
  >(null);
  const abort = useRef<AbortController | null>(null);
  const client = useQueryClient();
  const router = useRouter();
  useEffect(() => () => abort.current?.abort(), []);
  // The form edits two records, each saved by its own request: the order's
  // blinds, and the allocation's plan for them. Neither save touches the
  // other, so each has its own baseline to be dirty against.
  const orderQuery = useQuery({
    ...orderDetail(values.workOrderId),
    enabled: !!values.workOrderId,
  });
  const order = orderQuery.data;
  // The order's blinds as last read or saved here, with the revision a save
  // of them must name. A background refetch never replaces them.
  const [blinds, setBlinds] = useState<{
    id: string;
    revision: number;
    lines: WorkOrderLine[];
  } | null>(null);
  // A newly chosen order brings its blinds; the same order read again does not.
  if (order && order.id !== blinds?.id)
    setBlinds({ id: order.id, revision: order.revision, lines: order.lines });
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (!blinds || shown.current === blinds.id) return;
    shown.current = blinds.id;
    form.setValue('requirements', linesToRows(blinds.lines, units));
  }, [blinds, form, units]);
  const rowKey = (row: AllocationForm['requirements'][number]) =>
    JSON.stringify([
      row.id,
      row.fabricColorId,
      row.width,
      row.length,
      row.quantity,
    ]);
  const savedRows = linesToRows(blinds?.lines ?? [], units);
  const blindsDirty =
    !!blinds &&
    values.requirements.map(rowKey).join() !== savedRows.map(rowKey).join();
  const planKey = (value: AllocationForm) =>
    JSON.stringify([value.workOrderId, value.cuts]);
  const [planBaseline, setPlanBaseline] = useState(() =>
    planKey(form.getValues()),
  );
  const planDirty = planKey(values) !== planBaseline;
  // A live allocation's cuts were planned for these blinds.
  const frozen = !!active || !!order?.allocatedAt;
  const blocked =
    blinds?.id !== values.workOrderId
      ? orderQuery.error
        ? 'The order could not be loaded.'
        : 'Loading the order…'
      : blindsDirty
        ? 'Save the blinds before planning fabric for them.'
        : null;
  const { errors } = form.formState;
  useUnsavedChanges(planDirty || blindsDirty);
  const fieldName = (issue: ErrorIssue) =>
    allocationFieldName(issuePath(issue), form.getValues());
  // Issues with a field of their own show beside it; the rest stay in the
  // notice above the actions.
  const showIssues = (source: unknown) =>
    showFieldIssues(form, source, fieldName);
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: allocationKey }),
      client.invalidateQueries({ queryKey: stockKey }),
      // Confirming or moving an allocation changes its order's status.
      client.invalidateQueries({ queryKey: workOrdersKey }),
    ]);
  const saveBlinds = useMutation({
    mutationFn: async () => {
      const rows = form.getValues('requirements');
      const before = new Map(savedRows.map((row) => [row.id, rowKey(row)]));
      // A saved blind never changes, so an edited one goes under a new id.
      const renamed = new Map(
        rows
          .filter(
            (row) => before.has(row.id) && before.get(row.id) !== rowKey(row),
          )
          .map((row) => [row.id, crypto.randomUUID()]),
      );
      const lines = rowsToLines(
        rows.map((row) => ({ ...row, id: renamed.get(row.id) ?? row.id })),
        units,
      );
      const result = await saveOrderLines(blinds!.id, {
        expectedRevision: blinds!.revision,
        lines,
      });
      return { result, renamed };
    },
    onError: (error) => showIssues(error),
    onSuccess: async ({ result, renamed }) => {
      setBlinds({
        id: result.id,
        revision: result.revision,
        lines: result.lines,
      });
      form.setValue('requirements', linesToRows(result.lines, units));
      // The plan's assignments follow an edited blind to its new id. They are
      // the allocation's, so they are only changed here, not saved.
      form.setValue(
        'cuts',
        form.getValues('cuts').map((cut) => ({
          ...cut,
          items: cut.items.map((item) => ({
            ...item,
            requirementId:
              renamed.get(item.requirementId) ?? item.requirementId,
          })),
        })),
      );
      setPreview(null);
      await client.invalidateQueries({ queryKey: workOrdersKey });
    },
  });
  const save = useMutation({
    mutationFn: async (value: AllocationForm) => {
      const data = allocationFromForm(value);
      if (active)
        return replaceAllocation(active.id, {
          plan: data.plan,
          expectedRevision: active.revision,
        });
      return saved
        ? saveAllocationDraft(saved.id, saved.revision, data)
        : createAllocationDraft(data, requestKey(scope, data));
    },
    onError: (error) => {
      showIssues(error);
      if (
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 409
      )
        if (ownsPending) finishRequest(scope);
    },
    onSuccess: async (record) => {
      if (ownsPending) finishRequest(scope);
      if (record.state === 'draft') setSaved(record);
      setPlanBaseline(planKey(form.getValues()));
      client.setQueryData([...allocationKey, record.id], record);
      await refresh();
      if (active) close?.();
      // A save made on the way to confirming stays put: the dialog is still
      // open, and navigating would remount the form underneath it.
      else if (!initial && confirm !== 'submit')
        router.replace(`/allocations/${record.id}`);
    },
  });
  const submit = useMutation({
    mutationFn: async () => {
      // Submission carries no payload: the API confirms the stored draft. So
      // unsaved input is saved to the same draft first, as its own revision.
      const draft =
        saved && !planDirty ? saved : await save.mutateAsync(form.getValues());
      return submitAllocation(draft.id, draft.revision);
    },
    onError: (error) => showIssues(error),
    onSuccess: async (record) => {
      setPlanBaseline(planKey(form.getValues()));
      // The save on the way here cached the draft. Without the confirmed
      // record in its place, the page this navigates to would open on that
      // draft and keep it, as it keeps any draft open against a refetch.
      client.setQueryData([...allocationKey, record.id], record);
      await refresh();
      onSubmitted?.();
      router.replace(`/allocations/${record.id}`);
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteAllocationDraft(saved!.id, saved!.revision),
    onSuccess: async () => {
      form.reset();
      await refresh();
      router.push('/allocations?state=draft');
    },
  });
  const planning = useMutation({
    mutationFn: async (mode: 'optimize' | 'validate') => {
      const data = allocationFromForm(form.getValues());
      const target = active ?? saved;
      // The API plans the order's saved blinds, which is why unsaved ones
      // hold the plan back.
      const context = {
        workOrderId: data.workOrderId,
        ...(target
          ? { allocationId: target.id, expectedRevision: target.revision }
          : {}),
      };
      if (mode === 'validate')
        return validateAllocation({ ...context, plan: data.plan });
      abort.current = new AbortController();
      return optimizeAllocation(context, abort.current.signal);
    },
    onError: (error) => showIssues(error),
    onSuccess: (result) => {
      setPreview(result);
      showIssues('valid' in result && !result.valid ? result.issues : []);
      if ('status' in result && result.status === 'feasible') {
        const next = allocationToForm(
          { ...allocationFromForm(form.getValues()), plan: result.plan },
          [],
          units,
        );
        // A generated plan only changes the form; it neither saves nor reserves stock.
        form.setValue('cuts', next.cuts, { shouldDirty: true });
      }
    },
  });
  const reload = useMutation({
    mutationFn: () =>
      client.fetchQuery({ ...allocationDetail(saved!.id), staleTime: 0 }),
    onSuccess: (latest) => {
      if (latest.state === 'draft') {
        setSaved(latest);
        const next = allocationToForm(
          { workOrderId: latest.workOrderId, plan: latest.data.plan },
          [],
          units,
        );
        form.setValue('workOrderId', next.workOrderId);
        form.setValue('cuts', next.cuts);
        setPlanBaseline(planKey({ ...next, requirements: [] }));
      } else onSubmitted?.();
      save.reset();
      submit.reset();
      setValidationError(null);
    },
  });
  // A 409 about a field, such as an order that is already allocated, is fixed
  // in the form; only a stale record is fixed by reloading it.
  const conflict = [save.error, submit.error].some(
    (error) =>
      error instanceof ApiError &&
      error.status === 409 &&
      !error.issues.some(fieldName),
  );
  const busy =
    save.isPending ||
    saveBlinds.isPending ||
    submit.isPending ||
    remove.isPending ||
    planning.isPending;
  function confirmSubmit() {
    try {
      createAllocationSchema.parse(allocationFromForm(form.getValues()));
      setValidationError(null);
      form.clearErrors();
      setConfirm('submit');
    } catch (error) {
      setValidationError(error);
      showIssues(error);
    }
  }
  function closeConfirm() {
    setConfirm(null);
    // A failed confirmation may still have saved a new draft; move to its URL
    // so a reload reopens it.
    if (saved && !initial) router.replace(`/allocations/${saved.id}`);
  }
  const orderNumber =
    active?.orderNumber ?? order?.orderNumber ?? initial?.orderNumber;
  return (
    <>
      <PageHeading
        eyebrow={
          active
            ? 'EDIT ACTIVE PLAN'
            : saved
              ? `SHARED DRAFT · REVISION ${saved.revision}`
              : 'FROM ORDER TO CUTTING PLAN'
        }
        title={`${active ? 'Replan' : 'Allocate'} ${orderNumber ?? 'order'}`}
        description="Save the order's blinds, then generate a cutting plan or build one by hand."
      />
      {orderQuery.error && (
        <ErrorNotice
          error={orderQuery.error}
          retry={() => void orderQuery.refetch()}
        />
      )}
      {/* An issue with the order itself, such as one already allocated. */}
      {errors.workOrderId?.message && (
        <p className="notice notice-error" role="alert">
          Order {orderNumber}: {errors.workOrderId.message}
        </p>
      )}
      <form onSubmit={form.handleSubmit((value) => save.mutate(value))}>
        <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0 }}>
          <div className="stack">
            <RequirementsEditor
              form={form}
              units={units}
              onChange={() => setPreview(null)}
              frozen={
                frozen ? 'Fixed while the order has an allocation.' : undefined
              }
              actions={
                <Button
                  type="button"
                  variant={blindsDirty ? 'default' : 'outline'}
                  disabled={!blindsDirty || frozen}
                  onClick={() => saveBlinds.mutate()}
                >
                  <Save size={16} />
                  {saveBlinds.isPending
                    ? 'Saving…'
                    : blindsDirty
                      ? 'Save blinds'
                      : 'Blinds saved'}
                </Button>
              }
            />
            {saveBlinds.error && (
              <ErrorNotice
                error={saveBlinds.error}
                inline={(issue) => fieldName(issue) !== null}
              />
            )}
            {blocked && (
              <p className="notice notice-info" role="status">
                {blocked}
              </p>
            )}
            <fieldset
              disabled={!!blocked}
              style={{ border: 0, padding: 0, margin: 0 }}
            >
              <CutPlanEditor
                form={form}
                units={units}
                onChange={() => setPreview(null)}
                onGenerate={() => planning.mutate('optimize')}
                onValidate={() => planning.mutate('validate')}
              />
            </fieldset>
          </div>
        </fieldset>
        {/* One slot for planning feedback keeps the actions below from moving
            between the request and its result. It sits outside the fieldset
            so a running generation can still be cancelled. */}
        {planning.isPending ? (
          <div className="notice notice-info" role="status">
            <span>
              {planning.variables === 'optimize'
                ? 'Generating a cutting plan…'
                : 'Validating the plan…'}
            </span>
            {planning.variables === 'optimize' && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => abort.current?.abort()}
              >
                Cancel
              </Button>
            )}
          </div>
        ) : (
          preview && (
            <PlanPreview
              result={preview}
              inline={(issue) => fieldName(issue) !== null}
            />
          )
        )}
        {(save.error || validationError || planning.error) && (
          <ErrorNotice
            error={save.error ?? validationError ?? planning.error}
            inline={(issue) => fieldName(issue) !== null}
          />
        )}
        {save.error && recovery.success && (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => {
              const next = allocationToForm(recovery.data, [], units);
              form.setValue('workOrderId', next.workOrderId);
              form.setValue('cuts', next.cuts);
              save.reset();
            }}
          >
            Restore earlier request
          </Button>
        )}
        <div className="form-actions">
          <span className="draft-state">
            {planDirty
              ? 'Unsaved changes'
              : saved
                ? 'All changes saved'
                : active
                  ? 'Current active plan'
                  : 'Not saved yet'}
          </span>
          {close && (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                if (
                  !(planDirty || blindsDirty) ||
                  window.confirm('Discard your unsaved changes?')
                )
                  close();
              }}
            >
              Cancel editing
            </Button>
          )}
          {saved && (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => setConfirm('delete')}
            >
              Discard draft
            </Button>
          )}
          <Button
            type="submit"
            variant={active ? 'default' : 'outline'}
            disabled={busy || !!blocked}
          >
            <Save size={16} />
            {save.isPending
              ? 'Saving…'
              : active
                ? 'Update reservations'
                : 'Save draft'}
          </Button>
          {!active && (
            <Button
              type="button"
              disabled={busy || !!blocked}
              onClick={confirmSubmit}
            >
              <Check size={16} />
              Confirm allocation
            </Button>
          )}
        </div>
      </form>
      {saved && conflict && (
        <div className="notice notice-warning">
          <div>
            Your edits are still here. Reloading will replace them with the
            latest shared version.
            <Button
              type="button"
              variant="outline"
              disabled={reload.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    'Replace your local edits with the latest saved draft?',
                  )
                )
                  reload.mutate();
              }}
            >
              Reload saved draft
            </Button>
          </div>
        </div>
      )}
      {reload.error && <ErrorNotice error={reload.error} />}
      <Dialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open && !busy) closeConfirm();
        }}
        title={
          confirm === 'submit'
            ? 'Reserve this fabric?'
            : 'Discard this allocation draft?'
        }
        description={
          confirm === 'submit'
            ? `${planDirty || !saved ? 'Your changes are saved to the draft first. ' : ''}The complete plan is checked against current stock before reservations are created.`
            : 'This removes the shared draft for everyone.'
        }
      >
        {(submit.error || remove.error) && (
          <ErrorNotice error={submit.error ?? remove.error} />
        )}
        <div className="form-actions">
          <Button variant="outline" disabled={busy} onClick={closeConfirm}>
            Go back
          </Button>
          <Button
            variant={confirm === 'delete' ? 'destructive' : 'default'}
            disabled={busy}
            onClick={() =>
              confirm === 'submit' ? submit.mutate() : remove.mutate()
            }
          >
            {busy
              ? 'Working…'
              : confirm === 'submit'
                ? 'Confirm allocation'
                : 'Discard draft'}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
