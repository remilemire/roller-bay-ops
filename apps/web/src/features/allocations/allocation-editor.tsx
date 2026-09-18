'use client';
import { ApiError } from '@/lib/api';
import { RequirementsEditor } from './requirements-editor';
import { CutPlanEditor } from './cut-plan-editor';
import { PlanPreview } from './plan-preview';
import { useRef, useState, useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
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
import { TextField } from '@/components/ui/field';
import { ErrorNotice, PageHeading } from '@/components/ui/feedback';
import { stockKey } from '@/features/stock-items/stock-items.api';
import { useCurrentUser } from '@/features/auth/auth-boundary';
import { useMeasurementUnits } from '@/features/users/use-measurement-units';
import {
  pendingPayload,
  requestKey,
  finishRequest,
} from '@/lib/pending-request';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import {
  allocationFormSchema,
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
  const recovery = allocationDraftInputSchema.safeParse(pendingPayload(scope));
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
        plan: active.plan,
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
  useUnsavedChanges(form.formState.isDirty);
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: allocationKey }),
      client.invalidateQueries({ queryKey: stockKey }),
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
      if (
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 409
      )
        finishRequest(scope);
    },
    onSuccess: async (record) => {
      finishRequest(scope);
      if (record.state === 'draft') {
        setSaved(record);
        form.reset(allocationToForm(record.data, units));
      } else form.reset(form.getValues());
      client.setQueryData([...allocationKey, record.id], record);
      await refresh();
      if (active) close?.();
      else if (!initial) router.replace(`/allocations/${record.id}`);
    },
  });
  const submit = useMutation({
    mutationFn: () => submitAllocation(saved!.id, saved!.revision),
    onSuccess: async () => {
      form.reset(form.getValues());
      await refresh();
      onSubmitted?.();
      router.replace(`/allocations/${saved!.id}`);
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
    onSuccess: (result) => {
      setPreview(result);
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
  const conflict = [save.error, submit.error].some(
    (error) => error instanceof ApiError && error.status === 409,
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
      setConfirm('submit');
    } catch (error) {
      setValidationError(error);
    }
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
                <TextField
                  label="Order number"
                  value={values.orderNumber}
                  onChange={(v) =>
                    form.setValue('orderNumber', v, { shouldDirty: true })
                  }
                  maxLength={50}
                />
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
          preview && <PlanPreview result={preview} />
        )}
        {(save.error || validationError || planning.error) && (
          <ErrorNotice
            error={save.error ?? validationError ?? planning.error}
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
            {form.formState.isDirty
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
                  !form.formState.isDirty ||
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
            <Button
              type="button"
              disabled={busy || !saved || form.formState.isDirty}
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
          if (!open && !busy) setConfirm(null);
        }}
        title={
          confirm === 'submit'
            ? 'Reserve this fabric?'
            : 'Discard this allocation draft?'
        }
        description={
          confirm === 'submit'
            ? 'The complete plan is checked against current stock before reservations are created.'
            : 'This removes the shared draft for everyone.'
        }
      >
        {(submit.error || remove.error) && (
          <ErrorNotice error={submit.error ?? remove.error} />
        )}
        <div className="form-actions">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setConfirm(null)}
          >
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
