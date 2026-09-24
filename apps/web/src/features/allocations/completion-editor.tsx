'use client';
import {
  useEffect,
  useState,
  type ReactNode,
  type ComponentProps,
} from 'react';
import { useForm, useWatch, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  completeAllocationSchema,
  type AllocationDetail,
} from '@roller-bay/shared/allocations';
import { stockItemSchema } from '@roller-bay/shared/stock-items';
import { lookupStock, stockKey } from '@/features/stock-items';
import { api } from '@/lib/api';
import type { MeasurementUnits } from '@roller-bay/shared/users';
import { Plus, Trash2 } from 'lucide-react';
import { useCurrentUser } from '@/features/auth';
import { useMeasurementUnits } from '@/features/users';
import { fieldSuffix, measurementHelp } from '@/lib/measurements';
import { locationsKey, lookupLocations } from '@/features/locations';
import { Button } from '@/components/ui/button';
import { TextField, ChoiceField } from '@/components/ui/field';
import { Lookup } from '@/components/ui/lookup';
import { Dialog } from '@/components/ui/dialog';
import { ErrorNotice, PageHeading } from '@/components/ui/feedback';
import type { ErrorIssue } from '@roller-bay/shared/errors';
import { issuePath } from '@/lib/errors';
import { showFieldIssues } from '@/lib/field-issues';
import {
  requestKey,
  finishRequest,
  pendingPayload,
} from '@/lib/pending-request';
import { useUnsavedChanges } from '@/lib/use-unsaved-changes';
import { shortId } from '@/lib/format';
import { completeAllocation, allocationKey } from './allocations.api';
import {
  completionFieldName,
  completionItemToForm,
  completionFormSchema,
  completionFromForm,
  completionToForm,
  completionRecovery,
  type CompletionForm,
} from './completion-form';
export type CompletionEditorProps = {
  allocation: AllocationDetail;
  close: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  /** Recording at a cutting station, whose sheet owns drafts and submission. */
  worksheet?: {
    initialForm: CompletionForm | null;
    units: MeasurementUnits;
    /** Where the station may put returned stock. */
    lookupLocations: ComponentProps<typeof Lookup>['load'];
    saveDraft?: (form: CompletionForm) => Promise<void>;
    resolution?: boolean;
    confirmationFields?: ReactNode;
    submissionDisabled?: boolean;
    dirty?: boolean;
    submit: (
      body: ReturnType<typeof completionFromForm>,
      form: CompletionForm,
    ) => Promise<void>;
  };
};
export function CompletionEditor({
  allocation,
  close,
  worksheet,
  onDirtyChange,
}: CompletionEditorProps) {
  const user = useCurrentUser();
  // Pin the units this form opened with: a session refetch must not relabel
  // or reinterpret dirty input.
  const liveUnits = useMeasurementUnits();
  const [units] = useState(worksheet?.units ?? liveUnits);
  const [draftSaved, setDraftSaved] = useState(false);
  const saveDraft = useMutation({
    mutationFn: () => worksheet!.saveDraft!(form.getValues()),
    onSuccess: () => {
      setDraftSaved(true);
      form.reset(form.getValues());
    },
  });
  const scope = `completion:${user.id}:${allocation.id}:${allocation.revision}`;
  const recovery = completeAllocationSchema.safeParse(pendingPayload(scope));
  const form = useForm<CompletionForm>({
    resolver: zodResolver(completionFormSchema),
    defaultValues:
      worksheet?.initialForm ??
      (recovery.success
        ? completionRecovery(recovery.data, allocation, units)
        : completionToForm(allocation, units)),
  });
  const values = useWatch({ control: form.control }) as CompletionForm;
  const client = useQueryClient();
  const [extraId, setExtraId] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<unknown>(null);
  const additionalIds = values.items
    .filter(
      (row) =>
        !allocation.items.some((item) => item.stockItemId === row.stockItemId),
    )
    .map((row) => row.stockItemId);
  const extraStock = useQuery({
    queryKey: [...stockKey, 'completion-usage', additionalIds],
    enabled: additionalIds.length > 0,
    queryFn: ({ signal }) =>
      Promise.all(
        additionalIds.map((id) =>
          api(`/stock-items/${id}`, stockItemSchema, { signal }),
        ),
      ),
  });
  const loadingExtraStock = additionalIds.length > 0 && extraStock.isPending;
  async function addRoll() {
    setAdding(true);
    setAddError(null);
    try {
      const stock = await api(`/stock-items/${extraId}`, stockItemSchema);
      if (stock.consumedAt || stock.voidedAt)
        throw new Error('Select available fabric.');
      if (
        !allocation.requirements.some(
          (line) => line.fabricColorId === stock.fabricColorId,
        )
      )
        throw new Error('Select fabric used by this order.');
      const items = form.getValues('items');
      if (!items.some((item) => item.stockItemId === stock.id))
        form.setValue('items', [...items, completionItemToForm(stock, units)], {
          shouldDirty: true,
        });
      setExtraId('');
    } catch (error) {
      setAddError(error);
    } finally {
      setAdding(false);
    }
  }
  const [confirm, setConfirm] = useState(false);
  const [validationError, setValidationError] = useState<unknown>(null);
  const dirty = form.formState.isDirty || !!worksheet?.dirty;
  useUnsavedChanges(dirty);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  const fieldName = (issue: ErrorIssue) =>
    completionFieldName(issuePath(issue), form.getValues());
  // Issues with a field of their own show beside it; the rest stay in the
  // notice above the actions.
  const showIssues = (source: unknown) =>
    showFieldIssues(form, source, fieldName);
  const fieldError = (name: FieldPath<CompletionForm>) =>
    form.getFieldState(name, form.formState).error?.message;
  const mutation = useMutation({
    mutationFn: async (value: CompletionForm) => {
      const body = completionFromForm(value, allocation.revision, units);
      if (worksheet) await worksheet.submit(body, value);
      else
        await completeAllocation(allocation.id, body, requestKey(scope, body));
    },
    onError: (error) => showIssues(error),
    onSuccess: async () => {
      finishRequest(scope);
      form.reset(form.getValues());
      await Promise.all([
        client.invalidateQueries({ queryKey: allocationKey }),
        client.invalidateQueries({ queryKey: ['stock-items'] }),
        client.invalidateQueries({ queryKey: ['stock-receipts'] }),
        // Refresh related office views after reconciliation or station capture.
        client.invalidateQueries({ queryKey: ['work-orders'] }),
      ]);
      close();
    },
  });
  const change = (index: number, row: CompletionForm['items'][number]) => {
    form.setValue(
      'items',
      values.items.map((item, i) => (i === index ? row : item)),
      { shouldDirty: true },
    );
    form.clearErrors(`items.${index}`);
  };
  return (
    <>
      <PageHeading
        eyebrow="AFTER CUTTING"
        title={`${worksheet && !worksheet.resolution ? 'Cutting results' : 'Reconcile'} ${allocation.orderNumber}`}
        description={
          worksheet && !worksheet.resolution
            ? 'Save measurements as you work, then submit them for office review.'
            : 'Record what actually remains. Measurements update stock and any affected reservations.'
        }
      />
      <form
        onSubmit={form.handleSubmit((value) => {
          try {
            completionFromForm(value, allocation.revision, units);
            setValidationError(null);
            setConfirm(true);
          } catch (error) {
            setValidationError(error);
            showIssues(error);
          }
        })}
      >
        <fieldset
          disabled={
            mutation.isPending ||
            saveDraft.isPending ||
            adding ||
            loadingExtraStock
          }
          style={{ border: 0, margin: 0, padding: 0 }}
        >
          <div className="stack">
            {values.items.map((row, index) => {
              const planned = allocation.items.find(
                (i) => i.stockItemId === row.stockItemId,
              );
              const stock =
                planned?.stockItem ??
                extraStock.data?.find((item) => item.id === row.stockItemId);
              if (!stock)
                return (
                  <div key={row.stockItemId}>
                    <p>Loading additional roll {shortId(row.stockItemId)}…</p>
                    {!worksheet && extraStock.error && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          form.setValue(
                            'items',
                            values.items.filter(
                              (item) => item.stockItemId !== row.stockItemId,
                            ),
                            { shouldDirty: true },
                          )
                        }
                      >
                        Remove additional roll
                      </Button>
                    )}
                  </div>
                );
              return (
                <section className="panel" key={row.stockItemId}>
                  <div className="panel-heading">
                    <div>
                      <h2>
                        {stock.fabricColorCode} · {shortId(stock.id)}
                      </h2>
                      <p>
                        {stock.isRemnant ? 'Remnant' : 'Roll'} ·{' '}
                        {stock.zoneName} / {stock.sectionLabel} /{' '}
                        {stock.locationLabel}
                      </p>
                    </div>
                    {!planned && !worksheet && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          form.setValue(
                            'items',
                            values.items.filter(
                              (item) => item.stockItemId !== row.stockItemId,
                            ),
                            { shouldDirty: true },
                          )
                        }
                      >
                        Remove additional roll
                      </Button>
                    )}
                  </div>
                  <div className="panel-body stack">
                    <ChoiceField
                      label="What happened to this stock item?"
                      value={row.outcome}
                      onChange={(outcome) => change(index, { ...row, outcome })}
                      error={fieldError(`items.${index}.outcome`)}
                      options={[
                        ...(!worksheet && planned
                          ? [{ value: 'unused', label: 'Not used' }]
                          : []),
                        { value: 'consumed', label: 'Fully consumed' },
                        {
                          value: stock.isRemnant
                            ? 'returned-remnant'
                            : 'returned-roll',
                          label: stock.isRemnant
                            ? 'Remnant returned to storage'
                            : 'Roll returned to storage',
                        },
                      ]}
                    />
                    {row.outcome === 'unused' && (
                      <p>
                        Stock measurements stay unchanged. Its reservation will
                        be released.
                      </p>
                    )}
                    {row.outcome && row.outcome !== 'unused' && (
                      <div className="form-grid">
                        {!stock.isRemnant && (
                          <TextField
                            label={`Tube outer diameter (${fieldSuffix(units, 'tubeDiameter')})`}
                            help={measurementHelp.tubeDiameter}
                            type="number"
                            value={row.tube}
                            onChange={(tube) => change(index, { ...row, tube })}
                            error={fieldError(`items.${index}.tube`)}
                            disabled={stock.tubeOuterDiameterMm !== null}
                            hint="Required after first use."
                          />
                        )}
                        {row.outcome === 'returned-roll' && (
                          <TextField
                            label={`Radial depth (${fieldSuffix(units, 'radialDepth')})`}
                            help={measurementHelp.radialDepth}
                            type="number"
                            value={row.depth}
                            onChange={(depth) =>
                              change(index, { ...row, depth })
                            }
                            error={fieldError(`items.${index}.depth`)}
                          />
                        )}
                        {row.outcome === 'returned-remnant' && (
                          <>
                            <TextField
                              label={`Remaining width (${fieldSuffix(units, 'rollWidth')})`}
                              type="number"
                              value={row.width}
                              onChange={(width) =>
                                change(index, { ...row, width })
                              }
                              error={fieldError(`items.${index}.width`)}
                            />
                            <TextField
                              label={`Remaining length (${fieldSuffix(units, 'rollLength')})`}
                              type="number"
                              value={row.length}
                              onChange={(length) =>
                                change(index, { ...row, length })
                              }
                              error={fieldError(`items.${index}.length`)}
                            />
                          </>
                        )}
                        {row.outcome !== 'consumed' && (
                          <div className="span-full">
                            <Lookup
                              label={`Return location · ${shortId(stock.id)}`}
                              value={row.locationId}
                              onChange={(locationId) =>
                                change(index, { ...row, locationId })
                              }
                              error={fieldError(`items.${index}.locationId`)}
                              queryKey={locationsKey}
                              load={
                                worksheet?.lookupLocations ?? lookupLocations
                              }
                            />
                          </div>
                        )}
                      </div>
                    )}
                    {row.outcome !== 'unused' && (
                      <div>
                        <div className="form-row-header">
                          <h3>Retained remnants</h3>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() =>
                              change(index, {
                                ...row,
                                scraps: [
                                  ...row.scraps,
                                  {
                                    width: '',
                                    length: '',
                                    quantity: '',
                                    locationId: '',
                                  },
                                ],
                              })
                            }
                          >
                            <Plus size={16} />
                            Add remnant
                          </Button>
                        </div>
                        <p
                          className="muted"
                          style={{ fontSize: 11, margin: '8px 0 16px' }}
                        >
                          Each retained piece becomes a traceable stock item
                          linked to this fabric.
                        </p>
                        {row.scraps.map((scrap, si) => {
                          const update = (value: typeof scrap) =>
                            change(index, {
                              ...row,
                              scraps: row.scraps.map((s, i) =>
                                i === si ? value : s,
                              ),
                            });
                          return (
                            <div className="form-row" key={si}>
                              <div className="form-row-header">
                                <strong>Remnant group {si + 1}</strong>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Remove remnant ${si + 1} from ${shortId(stock.id)}`}
                                  onClick={() =>
                                    change(index, {
                                      ...row,
                                      scraps: row.scraps.filter(
                                        (_, i) => i !== si,
                                      ),
                                    })
                                  }
                                >
                                  <Trash2 size={16} />
                                </Button>
                              </div>
                              <TextField
                                label={`Width (${fieldSuffix(units, 'rollWidth')})`}
                                type="number"
                                value={scrap.width}
                                onChange={(width) =>
                                  update({ ...scrap, width })
                                }
                                error={fieldError(
                                  `items.${index}.scraps.${si}.width`,
                                )}
                              />
                              <TextField
                                label={`Length (${fieldSuffix(units, 'rollLength')})`}
                                type="number"
                                value={scrap.length}
                                onChange={(length) =>
                                  update({ ...scrap, length })
                                }
                                error={fieldError(
                                  `items.${index}.scraps.${si}.length`,
                                )}
                              />
                              <TextField
                                label="Quantity"
                                type="number"
                                value={scrap.quantity}
                                onChange={(quantity) =>
                                  update({ ...scrap, quantity })
                                }
                                error={fieldError(
                                  `items.${index}.scraps.${si}.quantity`,
                                )}
                              />
                              <div className="span-full">
                                <Lookup
                                  label={`Remnant destination · ${shortId(stock.id)} group ${si + 1}`}
                                  value={scrap.locationId}
                                  onChange={(locationId) =>
                                    update({ ...scrap, locationId })
                                  }
                                  error={fieldError(
                                    `items.${index}.scraps.${si}.locationId`,
                                  )}
                                  queryKey={locationsKey}
                                  load={
                                    worksheet?.lookupLocations ??
                                    lookupLocations
                                  }
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </section>
              );
            })}
            {!worksheet && (
              <section className="panel">
                <div className="panel-body stack">
                  <Lookup
                    label="Additional roll used"
                    value={extraId}
                    onChange={setExtraId}
                    queryKey={[...stockKey, 'completion-add', units.rollWidth]}
                    load={lookupStock(units.rollWidth)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={
                      !extraId ||
                      values.items.some((item) => item.stockItemId === extraId)
                    }
                    onClick={() => void addRoll()}
                  >
                    Add roll used
                  </Button>
                  {addError != null && <ErrorNotice error={addError} />}
                </div>
              </section>
            )}
          </div>
          {extraStock.error && (
            <ErrorNotice
              error={extraStock.error}
              retry={() => void extraStock.refetch()}
            />
          )}
          {Boolean(validationError) && (
            <ErrorNotice
              error={validationError}
              inline={(issue) => fieldName(issue) !== null}
            />
          )}
          {saveDraft.error && <ErrorNotice error={saveDraft.error} />}
          {draftSaved && !dirty && (
            <p className="notice notice-info" role="status">
              Progress saved.
            </p>
          )}
          <div className="form-actions">
            {worksheet?.saveDraft && (
              <Button
                type="button"
                variant="outline"
                onClick={() => saveDraft.mutate()}
              >
                Save progress
              </Button>
            )}
            {!worksheet?.saveDraft && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (
                    !dirty ||
                    window.confirm('Discard your unsaved cutting results?')
                  )
                    close();
                }}
              >
                Cancel
              </Button>
            )}
            <Button type="submit" disabled={!!extraStock.error}>
              {worksheet && !worksheet.resolution
                ? 'Review and submit results'
                : 'Review and reconcile'}
            </Button>
          </div>
        </fieldset>
      </form>
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title={
          worksheet && !worksheet.resolution
            ? 'Submit these results for office review?'
            : 'Record these cutting results?'
        }
        description={
          worksheet && !worksheet.resolution
            ? 'Submitting records cutting completion unless already recorded. The office reviews measurements before updating inventory.'
            : 'Stock measurements will be updated, retained remnants created, and this allocation reconciled. This does not change production milestones.'
        }
      >
        {!worksheet && (
          <ul>
            <li>
              Stock items used:{' '}
              {values.items.filter((item) => item.outcome !== 'unused').length}{' '}
              ({additionalIds.length} additional).
            </li>
            <li>
              Planned stock items not used:{' '}
              {values.items.filter((item) => item.outcome === 'unused').length}.
              Their measurements stay unchanged.
            </li>
            <li>The original cutting plan stays in history.</li>
          </ul>
        )}
        {worksheet?.confirmationFields}
        {mutation.error && <ErrorNotice error={mutation.error} />}
        <div className="form-actions">
          <Button
            variant="outline"
            disabled={
              mutation.isPending ||
              saveDraft.isPending ||
              adding ||
              loadingExtraStock
            }
            onClick={() => setConfirm(false)}
          >
            Go back
          </Button>
          <Button
            disabled={
              worksheet?.submissionDisabled ||
              mutation.isPending ||
              saveDraft.isPending ||
              adding ||
              loadingExtraStock
            }
            onClick={() => mutation.mutate(form.getValues())}
          >
            {mutation.isPending
              ? 'Recording…'
              : worksheet && !worksheet.resolution
                ? 'Submit results'
                : 'Reconcile allocation'}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
