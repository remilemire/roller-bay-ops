'use client';
import { ApiError } from '@/lib/api';
import { useState } from 'react';
import { useForm, useFieldArray, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import {
  stockReceiptDraftSchema,
  stockReceiptDraftDataSchema,
  createStockReceiptSchema,
} from '@roller-bay/shared/stock-receipts';
import { Plus, Save, Trash2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { TextField } from '@/components/ui/field';
import { Lookup } from '@/components/ui/lookup';
import { ErrorNotice, PageHeading } from '@/components/ui/feedback';
import {
  catalogKey,
  lookupColors,
} from '@/features/fabric-catalog/catalog.api';
import {
  locationsKey,
  lookupLocations,
} from '@/features/locations/locations.api';
import { useCurrentUser } from '@/features/auth/auth-boundary';
import { useMeasurementUnits } from '@/features/users/use-measurement-units';
import { fieldSuffix } from '@/lib/measurements';
import {
  pendingPayload,
  requestKey,
  finishRequest,
} from '@/lib/pending-request';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import {
  receiptFormSchema,
  receiptToForm,
  receiptFromForm,
  emptyReceiptLine,
  type ReceiptForm,
} from './receipt-form';
import {
  receiptDetail,
  createReceiptDraft,
  saveReceiptDraft,
  submitReceipt,
  deleteReceiptDraft,
  receiptKey,
} from './stock-receipts.api';
export function ReceiptEditor({
  initial,
  onSubmitted,
}: {
  initial?: z.infer<typeof stockReceiptDraftSchema>;
  onSubmitted?: () => void;
}) {
  const user = useCurrentUser();
  // Pin the units this form opened with: a session refetch must not relabel
  // or reinterpret dirty input.
  const liveUnits = useMeasurementUnits();
  const [units] = useState(liveUnits);
  const scope = `receipt:${user.id}:new`;
  const recovery = stockReceiptDraftDataSchema.safeParse(pendingPayload(scope));
  const form = useForm<ReceiptForm>({
    resolver: zodResolver(receiptFormSchema),
    defaultValues: receiptToForm(
      initial?.data ?? (recovery.success ? recovery.data : undefined),
      units,
    ),
  });
  const lines = useFieldArray({ control: form.control, name: 'items' });
  const values = useWatch({ control: form.control }) as ReceiptForm;
  const [saved, setSaved] = useState(initial);
  const [confirmation, setConfirmation] = useState<'submit' | 'delete' | null>(
    null,
  );
  const [validationError, setValidationError] = useState<unknown>(null);
  const client = useQueryClient();
  const router = useRouter();
  useUnsavedChanges(form.formState.isDirty);
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: receiptKey }),
      client.invalidateQueries({ queryKey: ['stock-items'] }),
    ]);
  const save = useMutation({
    mutationFn: async (value: ReceiptForm) => {
      const data = receiptFromForm(value, units);
      return saved
        ? saveReceiptDraft(saved.id, saved.revision, data)
        : createReceiptDraft(data, requestKey(scope, data));
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
    onSuccess: async (draft) => {
      finishRequest(scope);
      setSaved(draft);
      form.reset(receiptToForm(draft.data, units));
      client.setQueryData([...receiptKey, draft.id], draft);
      await refresh();
      if (!initial) router.replace(`/stock-receipts/${draft.id}`);
    },
  });
  const submit = useMutation({
    mutationFn: () => submitReceipt(saved!.id, saved!.revision),
    onSuccess: async () => {
      form.reset(form.getValues());
      await refresh();
      onSubmitted?.();
      router.replace(`/stock-receipts/${saved!.id}`);
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteReceiptDraft(saved!.id, saved!.revision),
    onSuccess: async () => {
      form.reset();
      await refresh();
      router.push('/stock-receipts?state=draft');
    },
  });
  const reload = useMutation({
    mutationFn: () =>
      client.fetchQuery({ ...receiptDetail(saved!.id), staleTime: 0 }),
    onSuccess: (latest) => {
      if (latest.state === 'draft') {
        setSaved(latest);
        form.reset(receiptToForm(latest.data, units));
      } else onSubmitted?.();
      save.reset();
      submit.reset();
      setValidationError(null);
    },
  });
  const conflict = [save.error, submit.error].some(
    (error) => error instanceof ApiError && error.status === 409,
  );
  const busy = save.isPending || submit.isPending || remove.isPending;
  const field = (
    index: number,
    name: keyof ReceiptForm['items'][number],
    value: string,
  ) => form.setValue(`items.${index}.${name}`, value, { shouldDirty: true });
  function confirmSubmit() {
    try {
      createStockReceiptSchema.parse(receiptFromForm(form.getValues(), units));
      setValidationError(null);
      setConfirmation('submit');
    } catch (error) {
      setValidationError(error);
    }
  }
  return (
    <>
      <PageHeading
        eyebrow={
          saved
            ? `SHARED DRAFT · REVISION ${saved.revision}`
            : 'INCOMING FABRIC'
        }
        title={saved ? 'Receipt draft' : 'New stock receipt'}
        description="Save as you go. Stock is created only when you submit the receipt."
      />
      <form onSubmit={form.handleSubmit((value) => save.mutate(value))}>
        <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0 }}>
          <section className="panel">
            <div className="panel-body">
              <TextField
                label="Purchase-order number"
                value={values.purchaseOrderNumber}
                onChange={(v) =>
                  form.setValue('purchaseOrderNumber', v, { shouldDirty: true })
                }
                maxLength={50}
              />
            </div>
          </section>
          <section className="panel" style={{ marginTop: 22 }}>
            <div className="panel-heading">
              <div>
                <h2>Received fabric</h2>
                <p>
                  One line per color, size, and destination. Quantity creates
                  individual rolls.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => lines.append(emptyReceiptLine())}
              >
                <Plus size={16} />
                Add line
              </Button>
            </div>
            <div className="panel-body">
              {lines.fields.length === 0 && (
                <p className="muted">
                  Add a line when you have the delivery details.
                </p>
              )}
              {lines.fields.map((row, index) => {
                // Field-array changes can render before the watched values catch up.
                const value = form.getValues(`items.${index}`) ?? row;
                return (
                  <div className="form-row" key={row.id}>
                    <div className="form-row-header">
                      <strong>Roll group {index + 1}</strong>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove receipt line ${index + 1}`}
                        onClick={() => lines.remove(index)}
                      >
                        <Trash2 size={16} />
                      </Button>
                    </div>
                    <Lookup
                      label={`Color · line ${index + 1}`}
                      value={value.fabricColorId}
                      onChange={(v) => field(index, 'fabricColorId', v)}
                      queryKey={[...catalogKey, 'colors']}
                      load={lookupColors}
                    />
                    <TextField
                      label={`Width (${fieldSuffix(units, 'rollWidth')})`}
                      type="number"
                      value={value.width}
                      onChange={(v) => field(index, 'width', v)}
                    />
                    <TextField
                      label={`Length per roll (${fieldSuffix(units, 'rollLength')})`}
                      type="number"
                      value={value.length}
                      onChange={(v) => field(index, 'length', v)}
                    />
                    <TextField
                      label="Quantity"
                      type="number"
                      value={value.quantity}
                      onChange={(v) => field(index, 'quantity', v)}
                    />
                    <div className="span-full">
                      <Lookup
                        label={`Destination · line ${index + 1}`}
                        value={value.locationId}
                        onChange={(v) => field(index, 'locationId', v)}
                        queryKey={locationsKey}
                        load={lookupLocations}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
          {(save.error || validationError || submit.error) && (
            <ErrorNotice
              error={save.error ?? validationError ?? submit.error}
            />
          )}
          {save.error && recovery.success && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                form.reset(receiptToForm(recovery.data, units));
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
                  : 'Not saved yet'}
            </span>
            {saved && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setConfirmation('delete')}
              >
                Discard draft
              </Button>
            )}
            <Button type="submit" variant="outline">
              <Save size={16} />
              {save.isPending ? 'Saving…' : 'Save draft'}
            </Button>
            <Button
              type="button"
              disabled={!saved || form.formState.isDirty}
              onClick={confirmSubmit}
            >
              <Check size={16} />
              Submit receipt
            </Button>
          </div>
          {form.formState.isDirty && saved && (
            <p
              className="muted"
              style={{ textAlign: 'right', marginTop: 10, fontSize: 11 }}
            >
              Save your changes before submitting.
            </p>
          )}
        </fieldset>
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
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirmation(null);
        }}
        title={
          confirmation === 'submit'
            ? 'Receive this fabric?'
            : 'Discard this draft?'
        }
        description={
          confirmation === 'submit'
            ? 'This creates stock items for every roll. Submitted receipts cannot be edited.'
            : 'This removes the shared draft for everyone.'
        }
      >
        {remove.error && <ErrorNotice error={remove.error} />}
        {submit.error && <ErrorNotice error={submit.error} />}
        <div className="form-actions">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setConfirmation(null)}
          >
            Go back
          </Button>
          <Button
            variant={confirmation === 'delete' ? 'destructive' : 'default'}
            disabled={busy}
            onClick={() =>
              confirmation === 'submit' ? submit.mutate() : remove.mutate()
            }
          >
            {busy
              ? 'Working…'
              : confirmation === 'submit'
                ? 'Submit receipt'
                : 'Discard draft'}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
