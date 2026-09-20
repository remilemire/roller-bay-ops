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
import { Lookup } from '@/components/ui/lookup';
import { ErrorNotice, PageHeading } from '@/components/ui/feedback';
import {
  lookupSchedulableOrders,
  orderByNumber,
  orderScheduleKey,
} from '@/features/order-schedule/order-schedule.api';
import { blindCount } from '@/features/order-schedule/order-totals';
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
import { cn } from '@/lib/utils';
import { showFieldIssues } from '@/lib/field-issues';
import {
  allocationFormSchema,
  allocationFieldName,
  allocationToForm,
  allocationFromForm,
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
export function AllocationEditor({
  initial,
  active,
  close,
  onSubmitted,
}: {
  initial?: z.infer<typeof allocationDraftSchema>;
  active?: AllocationDetail;
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
  const activeData = active
    ? allocationDraftInputSchema.parse({
        orderNumber: active.orderNumber,
        requirements: active.requirements.map(
          ({ id, fabricColorId, widthMm, lengthMm, quantity }) => ({
            id,
            fabricColorId,
            widthMm,
            lengthMm,
            quantity,
          }),
        ),
        // Stored cut lengths are derived; edits resubmit only the assignments.
        plan: {
          cuts: active.plan.cuts.map(({ stockItemId, items }) => ({
            stockItemId,
            items,
          })),
        },
      })
    : undefined;
  const form = useForm<AllocationForm>({
    resolver: zodResolver(allocationFormSchema),
    defaultValues: allocationToForm(
      initial?.data ??
        activeData ??
        (recovery.success ? recovery.data : undefined),
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
  // The API refuses an allocation whose blinds do not add up to its order's
  // quantity, so the form shows both and checks before asking to confirm.
  const order = useQuery({
    ...orderByNumber(values.orderNumber),
    enabled: /^\d{6}$/.test(values.orderNumber),
  }).data;
  const entered = values.requirements.reduce(
    (total, row) => total + (Number(row.quantity) || 0),
    0,
  );
  const mismatch = order ? order.quantity !== entered : false;
  const { errors, isDirty } = form.formState;
  useUnsavedChanges(isDirty);
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
      client.invalidateQueries({ queryKey: orderScheduleKey }),
    ]);
  const save = useMutation({
    mutationFn: async (value: AllocationForm) => {
      const data = allocationFromForm(value, units);
      if (active)
        return replaceAllocation(active.id, {
          ...data,
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
      if (record.state === 'draft') {
        setSaved(record);
        form.reset(allocationToForm(record.data, units));
      } else form.reset(form.getValues());
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
        saved && !form.formState.isDirty
          ? saved
          : await save.mutateAsync(form.getValues());
      return submitAllocation(draft.id, draft.revision);
    },
    onError: (error) => showIssues(error),
    onSuccess: async (record) => {
      form.reset(form.getValues());
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
      const data = allocationFromForm(form.getValues(), units);
      const target = active ?? saved;
      const context = {
        requirements: data.requirements,
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
          { ...allocationFromForm(form.getValues(), units), plan: result.plan },
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
        form.reset(allocationToForm(latest.data, units));
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
    submit.isPending ||
    remove.isPending ||
    planning.isPending;
  function confirmSubmit() {
    try {
      createAllocationSchema.parse(allocationFromForm(form.getValues(), units));
      setValidationError(null);
      form.clearErrors();
      if (order && mismatch) {
        form.setError('orderNumber', {
          message: `The order has ${blindCount(order.quantity)}; ${entered} entered.`,
        });
        return;
      }
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
        title={
          active
            ? `Replan ${active.orderNumber}`
            : saved
              ? 'Allocation draft'
              : 'New allocation'
        }
        description="Enter the required blinds, then generate a cutting plan or build one by hand."
      />
      <form onSubmit={form.handleSubmit((value) => save.mutate(value))}>
        <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0 }}>
          <div className="stack">
            <section className="panel">
              <div className="panel-body">
                {/* An allocation names an order from the schedule, so the
                    number is picked rather than typed. */}
                <Lookup
                  label="Order number"
                  value={values.orderNumber}
                  onChange={(v) => {
                    form.setValue('orderNumber', v, { shouldDirty: true });
                    form.clearErrors('orderNumber');
                  }}
                  selectedLabel={values.orderNumber}
                  queryKey={[...orderScheduleKey, 'schedulable']}
                  load={lookupSchedulableOrders}
                  error={errors.orderNumber?.message}
                />
                {order ? (
                  <p
                    className={cn('order-count', mismatch && 'is-mismatch')}
                    role="status"
                  >
                    The order has {blindCount(order.quantity)}; {entered}{' '}
                    entered.
                  </p>
                ) : (
                  <p className="order-count">
                    Lists scheduled orders that have no allocation yet.
                  </p>
                )}
              </div>
            </section>
            <RequirementsEditor
              form={form}
              units={units}
              onChange={() => setPreview(null)}
            />
            <CutPlanEditor
              form={form}
              units={units}
              onChange={() => setPreview(null)}
              onGenerate={() => planning.mutate('optimize')}
              onValidate={() => planning.mutate('validate')}
            />
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
              form.reset(allocationToForm(recovery.data, units));
              save.reset();
            }}
          >
            Restore earlier request
          </Button>
        )}
        <div className="form-actions">
          <span className="draft-state">
            {isDirty
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
                if (!isDirty || window.confirm('Discard your unsaved changes?'))
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
            disabled={busy}
          >
            <Save size={16} />
            {save.isPending
              ? 'Saving…'
              : active
                ? 'Update reservations'
                : 'Save draft'}
          </Button>
          {!active && (
            <Button type="button" disabled={busy} onClick={confirmSubmit}>
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
            ? `${isDirty || !saved ? 'Your changes are saved to the draft first. ' : ''}The complete plan is checked against current stock before reservations are created.`
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
