'use client';
import { useState } from 'react';
import { useForm, useWatch, type FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  completeAllocationSchema,
  type AllocationDetail,
} from '@roller-bay/shared/allocations';
import { Plus, Trash2 } from 'lucide-react';
import { useCurrentUser } from '@/features/auth/auth-boundary';
import { useMeasurementUnits } from '@/features/users/use-measurement-units';
import { fieldSuffix, measurementHelp } from '@/lib/measurements';
import {
  locationsKey,
  lookupLocations,
} from '@/features/locations/locations.api';
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
  completionFormSchema,
  completionFromForm,
  completionToForm,
  completionRecovery,
  type CompletionForm,
} from './completion-form';
export function CompletionEditor({
  allocation,
  close,
}: {
  allocation: AllocationDetail;
  close: () => void;
}) {
  const user = useCurrentUser();
  // Pin the units this form opened with: a session refetch must not relabel
  // or reinterpret dirty input.
  const liveUnits = useMeasurementUnits();
  const [units] = useState(liveUnits);
  const scope = `completion:${user.id}:${allocation.id}:${allocation.revision}`;
  const recovery = completeAllocationSchema.safeParse(pendingPayload(scope));
  const form = useForm<CompletionForm>({
    resolver: zodResolver(completionFormSchema),
    defaultValues: recovery.success
      ? completionRecovery(recovery.data, allocation, units)
      : completionToForm(allocation, units),
  });
  const values = useWatch({ control: form.control }) as CompletionForm;
  const client = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [validationError, setValidationError] = useState<unknown>(null);
  useUnsavedChanges(form.formState.isDirty);
  const fieldName = (issue: ErrorIssue) =>
    completionFieldName(issuePath(issue));
  // Issues with a field of their own show beside it; the rest stay in the
  // notice above the actions.
  const showIssues = (source: unknown) =>
    showFieldIssues(form, source, fieldName);
  const fieldError = (name: FieldPath<CompletionForm>) =>
    form.getFieldState(name, form.formState).error?.message;
  const mutation = useMutation({
    mutationFn: (value: CompletionForm) => {
      const body = completionFromForm(value, allocation.revision, units);
      return completeAllocation(allocation.id, body, requestKey(scope, body));
    },
    onError: (error) => showIssues(error),
    onSuccess: async () => {
      finishRequest(scope);
      form.reset(form.getValues());
      await Promise.all([
        client.invalidateQueries({ queryKey: allocationKey }),
        client.invalidateQueries({ queryKey: ['stock-items'] }),
        client.invalidateQueries({ queryKey: ['stock-receipts'] }),
        // Completing marks the scheduled order cut.
        client.invalidateQueries({ queryKey: ['order-schedule'] }),
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
        title={`Complete ${allocation.orderNumber}`}
        description="Record what actually remains. Measurements update stock and any affected reservations."
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
          disabled={mutation.isPending}
          style={{ border: 0, margin: 0, padding: 0 }}
        >
          <div className="stack">
            {values.items.map((row, index) => {
              const stock = allocation.items.find(
                (i) => i.stockItemId === row.stockItemId,
              )!.stockItem;
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
                  </div>
                  <div className="panel-body stack">
                    <ChoiceField
                      label="What happened to this stock item?"
                      value={row.outcome}
                      onChange={(outcome) => change(index, { ...row, outcome })}
                      error={fieldError(`items.${index}.outcome`)}
                      options={[
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
                    {row.outcome && (
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
                              load={lookupLocations}
                            />
                          </div>
                        )}
                      </div>
                    )}
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
                              onChange={(width) => update({ ...scrap, width })}
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
                                load={lookupLocations}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
          {Boolean(validationError) && (
            <ErrorNotice
              error={validationError}
              inline={(issue) => fieldName(issue) !== null}
            />
          )}
          <div className="form-actions">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (
                  !form.formState.isDirty ||
                  window.confirm('Discard your unsaved cutting results?')
                )
                  close();
              }}
            >
              Cancel
            </Button>
            <Button type="submit">Review and complete</Button>
          </div>
        </fieldset>
      </form>
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Record these cutting results?"
        description="Stock measurements will be updated, retained remnants created, and this allocation completed. Orders with insufficient remaining stock will be flagged for replanning."
      >
        {mutation.error && <ErrorNotice error={mutation.error} />}
        <div className="form-actions">
          <Button
            variant="outline"
            disabled={mutation.isPending}
            onClick={() => setConfirm(false)}
          >
            Go back
          </Button>
          <Button
            disabled={mutation.isPending}
            onClick={() => mutation.mutate(form.getValues())}
          >
            {mutation.isPending ? 'Recording…' : 'Complete order'}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
