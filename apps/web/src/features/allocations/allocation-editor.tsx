'use client';
import { ApiError } from '@/lib/api';
import { RequirementsEditor } from './requirements-editor';
import { CutPlanEditor } from './cut-plan-editor';
import { PlanPreview } from './plan-preview';
import { useRef, useState, useEffect, type ReactNode } from 'react';
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
  requirementInput,
} from '@roller-bay/shared/allocations';
import { Save, Check, Plus } from 'lucide-react';
import type { WorkOrder } from '@roller-bay/shared/work-orders';
import { Lookup } from '@/components/ui/lookup';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { ErrorNotice, PageHeading } from '@/components/ui/feedback';
import {
  blindCount,
  lookupUnallocatedOrders,
  orderDetail,
  orderLabel,
  workOrdersKey,
} from '@/features/work-orders';
import { stockKey } from '@/features/stock-items';
import { useCurrentUser } from '@/features/auth';
import { useMeasurementUnits } from '@/features/users';
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
  blindTotal,
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
 * A form opens blank or on a chosen order, on a shared draft, or on the active
 * plan it edits. An order is picked, or added as a request of its own.
 */
type Opening =
  | { workOrderId?: string; initial?: never; active?: never }
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
  addOrder,
}: Opening & {
  close?: () => void;
  onSubmitted?: () => void;
  /**
   * The add-order modal, composed by the route: work orders own it. The
   * editor opens it and picks the order it creates.
   */
  addOrder?: (props: {
    close: () => void;
    onCreated: (order: WorkOrder) => void;
  }) => ReactNode;
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
  // Blinds are sent without the plan's allowance, which the API applies.
  const opened = active ?? initial;
  const openedData = opened && {
    workOrderId: opened.workOrderId,
    requirements: (active
      ? active.requirements
      : initial!.data.requirements
    ).map(requirementInput),
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
          ? { workOrderId, requirements: [], plan: { cuts: [] } }
          : recovery.success
            ? recovery.data
            : undefined),
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
  const [adding, setAdding] = useState(false);
  // Whether a confirmation was tried: the count is checked from then on.
  const [countChecked, setCountChecked] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const client = useQueryClient();
  const router = useRouter();
  useEffect(() => () => abort.current?.abort(), []);
  // The order, for its number and the blind count its allocation must match.
  const orderQuery = useQuery({
    ...orderDetail(values.workOrderId),
    enabled: !!values.workOrderId,
  });
  const order = orderQuery.data;
  const entered = blindTotal(values);
  const mismatch = !!order && order.quantity !== entered;
  const formKey = (value: AllocationForm) =>
    JSON.stringify([value.workOrderId, value.requirements, value.cuts]);
  const [baseline, setBaseline] = useState(() => formKey(form.getValues()));
  const dirty = formKey(values) !== baseline;
  const { errors } = form.formState;
  useUnsavedChanges(dirty);
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
  const save = useMutation({
    mutationFn: async (value: AllocationForm) => {
      const data = allocationFromForm(value, units);
      if (active)
        return replaceAllocation(active.id, {
          requirements: data.requirements,
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
      setBaseline(formKey(form.getValues()));
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
        saved && !dirty ? saved : await save.mutateAsync(form.getValues());
      return submitAllocation(draft.id, draft.revision);
    },
    onError: (error) => showIssues(error),
    onSuccess: async (record) => {
      setBaseline(formKey(form.getValues()));
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
      const data = allocationFromForm(form.getValues(), units);
      const target = active ?? saved;
      // The API plans the blinds it is sent, so they must be complete.
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
        const next = allocationToForm(
          {
            workOrderId: latest.workOrderId,
            requirements: latest.data.requirements.map(requirementInput),
            plan: latest.data.plan,
          },
          units,
        );
        form.reset(next);
        setBaseline(formKey(next));
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
      // The API refuses blinds that do not add up to the order's count.
      setCountChecked(true);
      if (mismatch) return;
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
        description="Enter the order's blinds, then generate a cutting plan or build one by hand."
      />
      {orderQuery.error && (
        <ErrorNotice
          error={orderQuery.error}
          retry={() => void orderQuery.refetch()}
        />
      )}
      {/* An issue with an active plan's order, which has no picker. */}
      {active && errors.workOrderId?.message && (
        <p className="notice notice-error" role="alert">
          Order {orderNumber}: {errors.workOrderId.message}
        </p>
      )}
      <form
        onSubmit={form.handleSubmit((value) => {
          // A replan is confirmed as it saves, so its count is checked first.
          if (active) {
            setCountChecked(true);
            if (mismatch) return;
          }
          save.mutate(value);
        })}
      >
        <fieldset disabled={busy} className="form-fieldset">
          <div className="stack">
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>Order</h2>
                  <p>
                    {active
                      ? 'A plan stays with its order.'
                      : 'Orders with no allocation yet.'}
                  </p>
                </div>
                {!active && addOrder && (
                  <Button
                    variant="outline"
                    type="button"
                    onClick={() => setAdding(true)}
                  >
                    <Plus size={16} />
                    Add order
                  </Button>
                )}
              </div>
              <div className="panel-body">
                {active ? (
                  <p>{order ? orderLabel(order) : active.orderNumber}</p>
                ) : (
                  <Lookup
                    label="Order"
                    value={values.workOrderId}
                    onChange={(id) => {
                      form.setValue('workOrderId', id, { shouldDirty: true });
                      form.clearErrors('workOrderId');
                    }}
                    queryKey={[...workOrdersKey, 'unallocated']}
                    load={lookupUnallocatedOrders}
                    selectedLabel={order && orderLabel(order)}
                    error={errors.workOrderId?.message}
                  />
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
          <div className="notice notice-info notice-action" role="status">
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
              form.reset(allocationToForm(recovery.data, units), {
                keepDefaultValues: true,
              });
              save.reset();
            }}
          >
            Restore earlier request
          </Button>
        )}
        {countChecked && order && mismatch && (
          <p className="notice notice-error" role="alert">
            The order has {blindCount(order.quantity)}; the blinds add up to{' '}
            {entered}.
          </p>
        )}
        <div className="form-actions">
          <span className="draft-state">
            {dirty
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
                if (!dirty || window.confirm('Discard your unsaved changes?'))
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
            disabled={busy || !values.workOrderId}
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
              disabled={busy || !values.workOrderId}
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
            ? `${dirty || !saved ? 'Your changes are saved to the draft first. ' : ''}The complete plan is checked against current stock before reservations are created.`
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
      {adding &&
        addOrder?.({
          close: () => setAdding(false),
          onCreated: (created) => {
            // The new order is the one being allocated.
            form.setValue('workOrderId', created.id, { shouldDirty: true });
            form.clearErrors('workOrderId');
            setAdding(false);
          },
        })}
    </>
  );
}
